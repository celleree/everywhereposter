import axios from 'axios';
import { createWriteStream } from 'fs';
import { access, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

export interface PreparedVideoMediaFile {
  inputPath: string;
  isTemporary: boolean;
  cleanup: () => Promise<void>;
}

const REMOTE_MEDIA_TIMEOUT_MS = 120_000;
export const REMOTE_MEDIA_MAX_BYTES = 1000 * 1024 * 1024;

const createRemoteMediaTooLargeError = () =>
  new Error('Remote video exceeds the 1 GB copy-generation download limit.');

export const createRemoteMediaByteLimitStream = (
  maxBytes = REMOTE_MEDIA_MAX_BYTES
) => {
  let downloadedBytes = 0;

  return new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk, encoding);

      if (downloadedBytes > maxBytes) {
        callback(createRemoteMediaTooLargeError());
        return;
      }

      callback(null, chunk);
    },
  });
};

const getRemoteFileName = (path: string, originalName?: string | null) => {
  const originalBaseName = basename(originalName || '');
  if (originalBaseName && originalBaseName !== '.' && originalBaseName !== '..') {
    return originalBaseName;
  }

  try {
    const remoteBaseName = basename(new URL(path).pathname);
    return remoteBaseName && remoteBaseName !== '.' && remoteBaseName !== '..'
      ? remoteBaseName
      : 'uploaded-video.mp4';
  } catch {
    return 'uploaded-video.mp4';
  }
};

export const prepareVideoMediaFile = async (
  path: string,
  originalName?: string | null
): Promise<PreparedVideoMediaFile> => {
  if (!/^https?:\/\//i.test(path)) {
    await access(path);
    return {
      inputPath: path,
      isTemporary: false,
      cleanup: async () => undefined,
    };
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), 'postiz-video-source-'));
  const inputPath = join(
    workingDirectory,
    getRemoteFileName(path, originalName)
  );

  try {
    const response = await axios({
      url: path,
      method: 'GET',
      responseType: 'stream',
      timeout: REMOTE_MEDIA_TIMEOUT_MS,
      maxRedirects: 5,
      maxContentLength: REMOTE_MEDIA_MAX_BYTES,
    });
    const contentLength = Number(response.headers?.['content-length']);

    if (
      Number.isFinite(contentLength) &&
      contentLength > REMOTE_MEDIA_MAX_BYTES
    ) {
      response.data.destroy();
      throw createRemoteMediaTooLargeError();
    }

    await pipeline(
      response.data,
      createRemoteMediaByteLimitStream(),
      createWriteStream(inputPath, { flags: 'wx' })
    );

    return {
      inputPath,
      isTemporary: true,
      cleanup: async () => {
        await rm(workingDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(workingDirectory, { recursive: true, force: true });
    throw error;
  }
};
