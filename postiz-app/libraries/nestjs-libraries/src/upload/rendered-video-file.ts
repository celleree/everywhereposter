import { stat } from 'fs/promises';

export const RENDERED_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export async function assertRenderedVideoFile(path: string) {
  const info = await stat(path);
  const { fromFile } = require('file-type');
  const type = await fromFile(path);
  if (!info.isFile() || info.size <= 0 || info.size > RENDERED_VIDEO_MAX_BYTES || type?.mime !== 'video/mp4') {
    throw new Error('Use a rendered MP4 up to 100 MiB.');
  }
  return info.size;
}
