import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { assertRenderedVideoFile } from './rendered-video-file';

export interface IUploadProvider {
  storeStudioOutput(path: string, intent: StudioOutputIntent): Promise<StudioOutputReceipt>;
  uploadFromPath(path: string, originalName: string): Promise<UploadedFileReceipt>;
  uploadSimple(path: string): Promise<string>;
  uploadFile(file: Express.Multer.File): Promise<any>;
  removeFile(filePath: string): Promise<void>;
}

export interface StudioOutputIntent {
  organizationId: string;
  jobId: string;
  generation: number;
  sha256: string;
  bytes: number;
}
// Immutable, job-owned staging. There is intentionally no destructive rollback:
// a failed acknowledgement may belong to a successfully stored object.
export interface StudioOutputReceipt { key: string; path: string; sha256: string; bytes: number }
export function studioOutputKey(intent: StudioOutputIntent) {
  if (!intent || Object.keys(intent).sort().join(',') !== 'bytes,generation,jobId,organizationId,sha256' ||
      typeof intent.organizationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(intent.organizationId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(intent.jobId) ||
      !Number.isSafeInteger(intent.generation) || intent.generation < 1 || intent.generation > 10000 ||
      typeof intent.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(intent.sha256) || !Number.isSafeInteger(intent.bytes) || intent.bytes < 1 || intent.bytes > 100 * 1024 * 1024) {
    throw new Error('Invalid Studio output intent');
  }
  const org = createHash('sha256').update(intent.organizationId).digest('hex');
  return `studio/${org}/${intent.jobId}/g${intent.generation}-${intent.sha256}.mp4`;
}
export async function verifyStudioBytes(body: AsyncIterable<Uint8Array>, intent: StudioOutputIntent) {
  studioOutputKey(intent);
  let size = 0;
  const hash = createHash('sha256');
  for await (const chunk of body) {
    size += chunk.length;
    if (size > intent.bytes) throw new Error('Studio output size mismatch');
    hash.update(chunk);
  }
  if (size !== intent.bytes || hash.digest('hex') !== intent.sha256) throw new Error('Studio output hash mismatch');
}
export async function verifyStudioFile(path: string, intent: StudioOutputIntent) {
  studioOutputKey(intent);
  if (await assertRenderedVideoFile(path) !== intent.bytes) throw new Error('Studio output size mismatch');
  await verifyStudioBytes(createReadStream(path), intent);
}

// Rollback owns only this newly generated artifact; never serialize the receipt.
export interface UploadedFileReceipt {
  filename: string;
  originalname: string;
  path: string;
  mimetype: 'video/mp4';
  rollback: () => Promise<void>;
}
