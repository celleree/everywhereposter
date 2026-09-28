import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import { CustomFileValidationPipe } from '../upload/custom.upload.validation';
import { UploadFactory } from '../upload/upload.factory';
import type { MediaService } from '../database/prisma/media/media.service';
import type { IUploadProvider } from '../upload/upload.interface';
import { oauthToolMeta, requireOAuthScope } from './oauth-publishing.tools';

export const chatgptFileInput = z.object({ file: z.object({
  download_url: z.string().min(1).max(8192),
  file_id: z.string().min(1).max(200),
  mime_type: z.string().max(100).optional(),
  file_name: z.string().max(255).optional(),
}).strict() }).strict();
const MAX_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['168.63.129.16', 32], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  blocked.addSubnet(address, prefix, 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4') :
    family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function validateDownloadUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
    (url.port && url.port !== '443') || !url.hostname.includes('.') ||
    isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Invalid file download URL');
  return url;
}

// Resolve once inside the TLS connection's lookup. The socket uses these exact
// checked addresses, closing DNS-rebinding/validation-to-connect races.
export const publicLookup = (hostname: string, options: any, callback: any) => {
  lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      callback(new Error('File host is not public')); return;
    }
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }, () => callback(new Error('File host could not be resolved')));
};

export async function downloadChatGPTFile(value: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const url = validateDownloadUrl(value);
    return await new Promise<Buffer>((resolve, reject) => {
      const request = get(url, { lookup: publicLookup, signal: controller.signal, agent: false,
        headers: { Accept: 'image/*, video/mp4, video/quicktime', 'Accept-Encoding': 'identity' } }, async (response) => {
        try {
          // Reject every redirect, not just known private destinations.
          if (response.statusCode !== 200 ||
            (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') ||
            Number(response.headers['content-length'] || 0) > MAX_BYTES) throw new Error();
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of response) {
            size += chunk.length;
            if (size > MAX_BYTES) throw new Error();
            chunks.push(Buffer.from(chunk));
          }
          if (!size) throw new Error();
          resolve(Buffer.concat(chunks, size));
        } catch {
          response.destroy();
          request.destroy();
          reject(new Error('File download failed or exceeded the 64 MiB limit'));
        }
      });
      request.on('error', () => reject(new Error('File download failed or timed out')));
    });
  } catch { throw new Error('Unable to download file: use a public HTTPS file up to 64 MiB'); }
  finally { clearTimeout(timeout); }
}

const activeOrganizations = new Set<string>();
export function createChatGPTFileTool(
  media: Pick<MediaService, 'saveFile'>,
  download = downloadChatGPTFile,
  storage: () => IUploadProvider = () => UploadFactory.createStorage(),
) {
  return createTool({
    id: 'ingest_chatgpt_file',
    description: 'Import an attached ChatGPT image or MP4/MOV video into EverywherePoster for a post. Images up to 10 MiB; all files up to 64 MiB. Returns the media ID for prepare_post. Never publishes. Only pass a file the user intends to attach.',
    inputSchema: chatgptFileInput,
    mcp: { ...oauthToolMeta('posts:write', false, true),
      _meta: { ...oauthToolMeta('posts:write', false, true)._meta, 'openai/fileParams': ['file'] } },
    execute: async ({ file }) => {
      const { organizationId } = requireOAuthScope('posts:write');
      if (activeOrganizations.has(organizationId) || activeOrganizations.size >= 2) throw new Error('File import busy; retry after the current import completes');
      activeOrganizations.add(organizationId);
      try {
        const buffer = await download(file.download_url);
        if (buffer.length > MAX_BYTES) throw new Error();
        const name = (file.file_name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'attachment';
        const upload = await new CustomFileValidationPipe().transform({
          buffer, size: buffer.length, originalname: name,
        });
        const declared = file.mime_type === 'video/mov' ? 'video/quicktime' : file.mime_type;
        if (declared && declared !== upload.mimetype) throw new Error();
        const saved = await storage().uploadFile(upload);
        const result = await media.saveFile(organizationId, saved.originalname, saved.path, upload.originalname, upload.mimetype);
        return { mediaId: result.id, url: result.path, mimeType: upload.mimetype };
      } catch {
        // Never return/log provider errors, signed URLs, file IDs or raw buffers.
        throw new Error('Unable to import file. Check the file type, size, and download expiry.');
      } finally { activeOrganizations.delete(organizationId); }
    },
  });
}
