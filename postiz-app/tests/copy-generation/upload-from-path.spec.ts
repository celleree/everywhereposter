import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, stat, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalStorage } from '../../libraries/nestjs-libraries/src/upload/local.storage';
import { CloudflareStorage } from '../../libraries/nestjs-libraries/src/upload/cloudflare.storage';

describe('rendered-file storage receipts', () => {
  let directory: string;
  let source: string;
  const oldEnvironment = { ...process.env };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'render-storage-test-')); source = join(directory, 'source.mp4');
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=160x120:duration=4', '-f', 'lavfi', '-i', 'sine=duration=4', '-filter:a', "volume=0:enable='between(t,1,3)'", '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', '-shortest', source]);
    process.env.FRONTEND_URL = 'https://app.example';
    process.env.STORAGE_PROVIDER = 'local'; process.env.UPLOAD_DIRECTORY = directory;
  });
  afterAll(async () => { process.env = oldEnvironment; await rm(directory, { recursive: true, force: true }); });
  const cloud = () => {
    const storage = new CloudflareStorage('test', 'test', 'test', 'auto', 'bucket', 'https://media.example/prefix');
    const send = jest.fn().mockResolvedValue({}); (storage as any)._client = { send }; return { storage, send };
  };
  it('copies a real MP4, preserves the source and rolls back only the new file', async () => {
    const storage = new LocalStorage(join(directory, 'uploads')); const before = await readFile(source);
    const result = await storage.uploadFromPath(source, 'edited.mp4');
    const destination = join(directory, 'uploads', new URL(result.path).pathname.replace(/^\/uploads\//, ''));
    expect(await readFile(destination)).toEqual(before); expect(await readFile(source)).toEqual(before);
    expect(result.originalname).toBe('edited.mp4'); expect(result.mimetype).toBe('video/mp4');
    await result.rollback(); await result.rollback(); await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source)).toEqual(before);
  });
  it('streams R2 with known length and rolls back the exact generated key', async () => {
    const { storage, send } = cloud(); const result = await storage.uploadFromPath(source, 'edited.mp4');
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'bucket', Key: result.filename, ContentType: 'video/mp4', ContentLength: (await stat(source)).size });
    expect(Buffer.isBuffer(send.mock.calls[0][0].input.Body)).toBe(false);
    expect(result.path).toBe(`https://media.example/prefix/${result.filename}`);
    await result.rollback();
    expect(send.mock.calls[1][0].constructor.name).toBe('DeleteObjectCommand');
    expect(send.mock.calls[1][0].input).toEqual({ Bucket: 'bucket', Key: result.filename });
    expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it('attempts generated-key cleanup on an uncertain R2 write and never resends', async () => {
    const { storage, send } = cloud(); send.mockRejectedValueOnce(new Error('network failure'));
    await expect(storage.uploadFromPath(source, 'edited.mp4')).rejects.toThrow('network failure');
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0].constructor.name).toBe('DeleteObjectCommand');
    expect(send.mock.calls[1][0].input.Key).toBe(send.mock.calls[0][0].input.Key);
    expect(await stat(source)).toBeDefined();
  });
  it('rejects invalid data before any local/R2 write', async () => {
    const path = join(directory, 'invalid.mp4'); await writeFile(path, 'not video');
    const { storage, send } = cloud();
    await expect(storage.uploadFromPath(path, 'edited.mp4')).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
    await expect(new LocalStorage(join(directory, 'uploads')).uploadFromPath(path, 'edited.mp4')).rejects.toThrow();
  });
});
