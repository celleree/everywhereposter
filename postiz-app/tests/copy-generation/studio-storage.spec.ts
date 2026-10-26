import { createHash, randomUUID } from 'crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
import { join, dirname, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { LocalStorage } from '../../libraries/nestjs-libraries/src/upload/local.storage';
import { CloudflareStorage } from '../../libraries/nestjs-libraries/src/upload/cloudflare.storage';
import { studioOutputKey, StudioOutputIntent } from '../../libraries/nestjs-libraries/src/upload/upload.interface';

// Exercise storage identity/atomicity with tiny synthetic bytes, not codecs.
// Existing rendered-video-file tests retain the real format/size admission gate.
jest.mock('../../libraries/nestjs-libraries/src/upload/rendered-video-file', () => ({
  assertRenderedVideoFile: async (file: string) => (await require('fs/promises').stat(file)).size,
}));
describe('immutable Studio staging storage', () => {
  let root: string, source: string, intent: StudioOutputIntent;
  const content = Buffer.from('synthetic-rendered-mp4-fixture');
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'studio-storage-')); source = join(root, 'source.mp4');
    await writeFile(source, content);
    intent = { organizationId: 'owner', jobId: randomUUID(), generation: 1, bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex') };
  });
  afterEach(async () => {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'studio-storage-')) throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  });
  it('concurrent local stores and acknowledgement replay share verified bytes without changing the source', async () => {
    const store = new LocalStorage(root);
    const copies = await Promise.all([store.storeStudioOutput(source, intent), store.storeStudioOutput(source, intent)]);
    expect(copies[0]).toEqual(copies[1]); expect(await store.storeStudioOutput(source, intent)).toEqual(copies[0]);
    expect(await readFile(join(root, copies[0].key))).toEqual(content);
    expect(await readFile(source)).toEqual(content);
    expect(copies[0]).not.toHaveProperty('rollback');
  });
  it('never overwrites or deletes an existing conflicting local object', async () => {
    const key = studioOutputKey(intent), target = join(root, key);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, 'conflicting-object');
    await expect(new LocalStorage(root).storeStudioOutput(source, intent)).rejects.toThrow('mismatch');
    expect(await readFile(target, 'utf8')).toBe('conflicting-object');
  });
  it('binds the namespace to organization, job, generation and hash and rejects path-like identities', () => {
    expect(studioOutputKey(intent)).not.toBe(studioOutputKey({ ...intent, organizationId: 'another-org' }));
    expect(studioOutputKey(intent)).not.toBe(studioOutputKey({ ...intent, generation: 2 }));
    expect(() => studioOutputKey({ ...intent, jobId: '../escape' })).toThrow();
    expect(() => studioOutputKey({ ...intent, bytes: 0 })).toThrow();
  });
  function remote(objects: Map<string, Buffer>, loseAcknowledgement = false) {
    const store = new CloudflareStorage('synthetic', 'fixture', 'fixture', 'auto', 'fixture-bucket', 'https://storage.example.test');
    const send = jest.fn(async (command: any) => {
      const key = command.input.Key;
      if (command instanceof GetObjectCommand) {
        const bytes = objects.get(key);
        if (!bytes) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        return { ContentLength: bytes.length, Body: Readable.from([bytes]) };
      }
      if (command instanceof PutObjectCommand) {
        expect(command.input.IfNoneMatch).toBe('*');
        if (objects.has(key)) throw Object.assign(new Error('conflict'), { $metadata: { httpStatusCode: 412 } });
        const chunks: Buffer[] = []; for await (const chunk of command.input.Body) chunks.push(chunk);
        objects.set(key, Buffer.concat(chunks));
        if (loseAcknowledgement) throw new Error('Put acknowledgement lost');
        return {};
      }
      throw new Error('Unexpected storage mutation');
    });
    (store as any)._client = { send };
    return { store, send };
  }
  it('recovers a lost remote PUT acknowledgement and never sends a second PUT or DELETE', async () => {
    const { store, send } = remote(new Map(), true);
    const first = await store.storeStudioOutput(source, intent);
    expect(await store.storeStudioOutput(source, intent)).toEqual(first);
    expect(send.mock.calls.filter(([command]) => command instanceof PutObjectCommand)).toHaveLength(1);
    expect(send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(false);
  });
  it('fails closed on remote tampering instead of replacing an immutable object', async () => {
    const conflicting = Buffer.alloc(content.length, 'x');
    const { store, send } = remote(new Map([[studioOutputKey(intent), conflicting]]));
    await expect(store.storeStudioOutput(source, intent)).rejects.toThrow('hash mismatch');
    expect(send.mock.calls.every(([command]) => command instanceof GetObjectCommand)).toBe(true);
  });
  it('does not PUT when existing remote storage cannot be checked', async () => {
    const { store, send } = remote(new Map()); send.mockRejectedValueOnce(new Error('Read outcome unknown'));
    await expect(store.storeStudioOutput(source, intent)).rejects.toThrow('unknown');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
