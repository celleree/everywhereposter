import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import { z } from 'zod';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

const CHATGPT_FILE_HOST_SUFFIXES = ['.openai.com', '.oaiusercontent.com'];
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'video/quicktime',
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

const chatGptFileSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string(),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
});

@Injectable()
export class ChatGptMediaUploadTool implements AgentToolInterface {
  private storage = UploadFactory.createStorage();
  constructor(private _mediaService: MediaService) {}
  name = 'chatGptMediaUploadTool';

  run() {
    return createTool({
      id: 'uploadChatGptMedia',
      description:
        'Import an image or video the user attached in ChatGPT into EverywherePoster. Use the returned path as an attachment URL when scheduling a post.',
      inputSchema: z.object({ file: chatGptFileSchema }),
      mcp: {
        annotations: {
          title: 'Upload ChatGPT Media',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        _meta: {
          'openai/fileParams': ['file'],
        },
      },
      outputSchema: z.object({
        output: z.object({
          id: z.string(),
          path: z.string(),
          name: z.string(),
          originalName: z.string().nullable(),
          type: z.string(),
          mimeType: z.string(),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        let url = new URL(inputData.file.download_url);
        let response: Response | undefined;
        for (let redirects = 0; redirects <= 3; redirects++) {
          const hostname = url.hostname.toLowerCase();
          const trustedHost = CHATGPT_FILE_HOST_SUFFIXES.some(
            (suffix) =>
              hostname === suffix.slice(1) || hostname.endsWith(suffix)
          );
          if (url.protocol !== 'https:' || !trustedHost) {
            throw new Error('Only ChatGPT temporary file URLs are accepted.');
          }

          response = await fetch(url, { redirect: 'manual' });
          if (response.status < 300 || response.status >= 400) {
            break;
          }

          const location = response.headers.get('location');
          if (!location) {
            throw new Error('ChatGPT file redirect is missing a location.');
          }
          url = new URL(location, url);
        }

        if (!response?.ok) {
          throw new Error(
            `Unable to download ChatGPT file: HTTP ${response?.status || 'unknown'}`
          );
        }

        const advertisedLength = Number(response.headers.get('content-length'));
        if (
          Number.isFinite(advertisedLength) &&
          advertisedLength > MAX_VIDEO_BYTES
        ) {
          throw new Error(`File exceeds the ${MAX_VIDEO_BYTES}-byte upload limit.`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const detected = await fromBuffer(buffer);
        if (!detected || !ALLOWED_MIME.has(detected.mime)) {
          throw new Error('Unsupported file type.');
        }

        const maxBytes = detected.mime.startsWith('image/')
          ? MAX_IMAGE_BYTES
          : MAX_VIDEO_BYTES;
        if (buffer.length > maxBytes) {
          throw new Error(`File exceeds the ${maxBytes}-byte upload limit.`);
        }

        const uploaded = await this.storage.uploadFile({
          buffer,
          mimetype: detected.mime,
          size: buffer.length,
          path: '',
          fieldname: 'file',
          destination: '',
          stream: new Readable(),
          filename: inputData.file.file_name || '',
          originalname: inputData.file.file_name || `chatgpt.${detected.ext}`,
          encoding: '',
        });

        const saved = await this._mediaService.saveFile(
          organizationId,
          uploaded.originalname,
          uploaded.path,
          inputData.file.file_name,
          detected.mime
        );

        return {
          output: {
            id: saved.id,
            path: saved.path,
            name: saved.name,
            originalName: saved.originalName || null,
            type: saved.type,
            mimeType: detected.mime,
          },
        };
      },
    });
  }
}

@Injectable()
export class PostStatusTool implements AgentToolInterface {
  constructor(private _postsRepository: PostsRepository) {}
  name = 'postStatusTool';

  run() {
    return createTool({
      id: 'getPostStatus',
      description:
        'Get the current EverywherePoster state and published URL for a post previously created or scheduled.',
      inputSchema: z.object({ postId: z.string() }),
      mcp: {
        annotations: {
          title: 'Get Post Status',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        output: z.object({
          found: z.boolean(),
          id: z.string().optional(),
          state: z.string().optional(),
          publishDate: z.string().optional(),
          releaseURL: z.string().nullable().optional(),
          error: z.string().nullable().optional(),
          platform: z.string().optional(),
          account: z.string().optional(),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;
        const post = await this._postsRepository.getPost(
          inputData.postId,
          true,
          organizationId,
          true
        );

        if (!post) {
          return { output: { found: false } };
        }

        return {
          output: {
            found: true,
            id: post.id,
            state: post.state,
            publishDate: post.publishDate.toISOString(),
            releaseURL: post.releaseURL,
            error: post.error,
            platform: post.integration?.providerIdentifier,
            account: post.integration?.name,
          },
        };
      },
    });
  }
}
