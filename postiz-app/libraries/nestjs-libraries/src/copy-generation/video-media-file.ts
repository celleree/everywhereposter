import axios from 'axios';
import { createWriteStream } from 'fs';
import { access, mkdtemp, realpath, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join, resolve, sep } from 'path';
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

const getLocalUploadStaticDirectory = () => {
  const directory =
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY ||
    process.env.NEXT_PUBLIC_UPLOAD_DIRECTORY ||
    '/uploads';
  return `/${directory.replace(/^\/+|\/+$/g, '')}`;
};

export const resolveLocalUploadVideoPath = async (
  mediaPath: string
): Promise<string | undefined> => {
  const uploadDirectory = process.env.UPLOAD_DIRECTORY;
  const frontendUrl = process.env.FRONTEND_URL;
  if (
    process.env.STORAGE_PROVIDER !== 'local' ||
    !uploadDirectory ||
    !frontendUrl
  ) {
    return undefined;
  }

  let mediaUrl: URL;
  let appUrl: URL;
  try {
    mediaUrl = new URL(mediaPath);
    appUrl = new URL(frontendUrl);
  } catch {
    return undefined;
  }

  if (mediaUrl.origin !== appUrl.origin) {
    return undefined;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(mediaUrl.pathname);
  } catch {
    return undefined;
  }

  const uploadPrefix = getLocalUploadStaticDirectory();
  if (!pathname.startsWith(`${uploadPrefix}/`)) {
    return undefined;
  }

  const relativePath = pathname.slice(uploadPrefix.length).replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('\0')) {
    return undefined;
  }

  const uploadRoot = resolve(uploadDirectory);
  const candidatePath = resolve(uploadRoot, relativePath);
  if (
    candidatePath === uploadRoot ||
    !candidatePath.startsWith(`${uploadRoot}${sep}`)
  ) {
    return undefined;
  }

  try {
    const realUploadRoot = await realpath(uploadRoot);
    const realCandidatePath = await realpath(candidatePath);
    if (
      realCandidatePath === realUploadRoot ||
      !realCandidatePath.startsWith(`${realUploadRoot}${sep}`) ||
      !(await stat(realCandidatePath)).isFile()
    ) {
      return undefined;
    }

    return realCandidatePath;
  } catch {
    return undefined;
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

  const localUploadPath = await resolveLocalUploadVideoPath(path);
  if (localUploadPath) {
    return {
      inputPath: localUploadPath,
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
