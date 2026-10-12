import { BadRequestException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';

export const VIDEO_CHUNK_BYTES = 8 * 1024 * 1024;
// Match the existing copy-generation consumer, separately from duration.
export const VIDEO_MAX_BYTES = 1000 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 600;
export const UPLOAD_FREE_FLOOR = 2 * 1024 * 1024 * 1024;
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_UPLOAD_STATES = ['UPLOADING', 'FINALIZING'];

export function validateVideoProbe(probe: any) {
  const duration = Number(probe?.format?.duration);
  const formats = String(probe?.format?.format_name || '').split(',');
  if (!formats.some((name) => name === 'mov' || name === 'mp4') ||
      !probe?.streams?.some((stream: any) => stream.codec_type === 'video' && stream.codec_name) ||
      !Number.isFinite(duration) || duration <= 0 || duration > VIDEO_MAX_SECONDS) {
    throw new BadRequestException('Use a valid MP4 or MOV video up to 600 seconds (HEVC in these containers is supported).');
  }
  return duration;
}

export async function validateVideoOnDisk(path: string, expectedBytes: number) {
  const info = await stat(path);
  if (!info.isFile() || info.size !== expectedBytes || info.size > VIDEO_MAX_BYTES) {
    throw new BadRequestException('Video size does not match the upload reservation.');
  }
  // file-type reads only the header. ffprobe cannot open network/playlist protocols.
  const { fromFile } = require('file-type');
  const detected = await fromFile(path);
  if (!detected || !['video/mp4', 'video/quicktime'].includes(detected.mime)) {
    throw new BadRequestException('Unsupported video container.');
  }
  try {
    const { stdout, stderr } = await promisify(execFile)('ffprobe', [
      '-v', 'error', '-count_packets', '-protocol_whitelist', 'file', '-show_entries',
      'format=duration,format_name:stream=codec_type,codec_name,nb_frames,nb_read_packets', '-of', 'json', path,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    if (stderr.trim()) throw new BadRequestException('The video contains corrupt or truncated packets.');
    const probe = JSON.parse(stdout);
    const video = probe.streams?.find((stream: any) => stream.codec_type === 'video');
    if (!video || Number(video.nb_read_packets) <= 0 || (Number(video.nb_frames) > 0 && Number(video.nb_read_packets) < Number(video.nb_frames))) throw new BadRequestException('The video is incomplete.');
    return { duration: validateVideoProbe(JSON.parse(stdout)), mime: detected.mime, ext: detected.ext };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('The video is corrupt or could not be validated.');
  }
}
