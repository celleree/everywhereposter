import axios from 'axios';
import { createWriteStream } from 'fs';
import { access, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { pipeline } from 'stream/promises';

export interface PreparedVideoMediaFile {
  inputPath: string;
  isTemporary: boolean;
  cleanup: () => Promise<void>;
}

const REMOTE_MEDIA_TIMEOUT_MS = 120_000;

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
    });

    await pipeline(response.data, createWriteStream(inputPath, { flags: 'wx' }));

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
