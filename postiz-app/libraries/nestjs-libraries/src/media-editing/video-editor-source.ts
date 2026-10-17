import { realpath, stat } from 'fs/promises';
import { resolve, sep } from 'path';
import { prepareVideoMediaFile, resolveLocalUploadVideoPath } from '../copy-generation/video-media-file';
import { TALKING_HEAD_EDIT_DEFAULTS } from './ffmpeg-video-editor.service';

export async function prepareEditorSource(path: string, originalName?: string) {
  if (!path || /[\\\u0000-\u001f\u007f]/.test(path)) throw new Error('Invalid source path');
  const provider = process.env.STORAGE_PROVIDER || 'local';
  if (provider === 'local') {
    let local: string | undefined;
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      if (url.username || url.password) throw new Error('Invalid local source URL');
      local = await resolveLocalUploadVideoPath(path);
    } else if (process.env.UPLOAD_DIRECTORY) {
      const root = await realpath(process.env.UPLOAD_DIRECTORY);
      const candidate = await realpath(resolve(path));
      if (candidate.startsWith(`${root}${sep}`) && (await stat(candidate)).isFile()) local = candidate;
    }
    if (!local) throw new Error('Source is outside configured uploads');
    if ((await stat(local)).size > TALKING_HEAD_EDIT_DEFAULTS.maxBytes) throw new Error('Source is too large');
    return prepareVideoMediaFile(local, originalName);
  }
  const url = new URL(path);
  const configured = new URL(process.env.CLOUDFLARE_BUCKET_URL!);
  if (provider !== 'cloudflare' || url.protocol !== 'https:' || url.username || url.password ||
      url.origin !== configured.origin || !url.pathname.startsWith(`${configured.pathname.replace(/\/+$/, '')}/`)) {
    throw new Error('Source is outside configured storage');
  }
  return prepareVideoMediaFile(url.href, originalName, {
    maxBytes: TALKING_HEAD_EDIT_DEFAULTS.maxBytes, maxRedirects: 0, signal: AbortSignal.timeout(30_000),
  });
}
