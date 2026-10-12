import { ValidationPipe } from '@nestjs/common';
import { CreateVideoUploadDto } from '../../libraries/nestjs-libraries/src/dtos/media/create.video.upload.dto';
import { PrismaService } from '../../libraries/nestjs-libraries/src/database/prisma/prisma.service';
import { ResumableUploadService } from '../../libraries/nestjs-libraries/src/upload/resumable-upload.service';
import { VIDEO_CHUNK_BYTES, validateVideoOnDisk } from '../../libraries/nestjs-libraries/src/upload/resumable-video.validation';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdtemp, readFile, writeFile, open, stat, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { PassThrough, Readable } from 'stream';
import { execFileSync } from 'child_process';

const fixtureUrl = process.env.EP_UPLOAD_TEST_DATABASE_URL;
if (fixtureUrl && fixtureUrl !== 'postgresql://isolated:isolated@127.0.0.1:55463/isolated') throw new Error('Upload integration tests require the exact disposable fixture URL.');
const suite = fixtureUrl ? describe : describe.skip;
suite('persistent upload transport (disposable PostgreSQL, no providers)', () => {
  let db: PrismaService, service: ResumableUploadService, root: string, source: Buffer;
  const org = 'isolated-upload-org', other = 'isolated-upload-other', third = 'isolated-upload-third';
  const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  const input = (data = source, organizationId = org) => ({ organizationId, clientId: randomUUID(), originalName: 'fixture.mp4', byteSize: data.length, manifest: [digest(data)] });
  beforeAll(async () => {
    process.env.DATABASE_URL = fixtureUrl;
    process.env.STORAGE_PROVIDER = 'local'; process.env.FRONTEND_URL = 'http://localhost:isolated';
    root = await mkdtemp(join(tmpdir(), 'ep-upload-test-')); process.env.UPLOAD_DIRECTORY = root;
    db = new PrismaService(); await db.$connect(); service = new ResumableUploadService(db);
    for (const id of [org, other, third]) await db.organization.upsert({ where: { id }, create: { id, name: id }, update: {} });
    source = await readFile(resolve('tests/browser/assets/synthetic-picker.mp4'));
  });
  beforeEach(async () => {
    await db.videoUploadPart.deleteMany({ where: { session: { organizationId: { in: [org, other, third] } } } });
    await db.videoUploadSession.deleteMany({ where: { organizationId: { in: [org, other, third] } } });
    await db.media.deleteMany({ where: { organizationId: { in: [org, other, third] } } });
  });
  afterAll(async () => {
    await db.videoUploadPart.deleteMany({ where: { session: { organizationId: { in: [org, other, third] } } } });
    await db.videoUploadSession.deleteMany({ where: { organizationId: { in: [org, other, third] } } });
    await db.media.deleteMany({ where: { organizationId: { in: [org, other, third] } } });
    await db.organization.deleteMany({ where: { id: { in: [org, other, third] } } });
    await db.$disconnect(); await rm(root, { recursive: true, force: true });
  });
  it('reserves one stable session, rejects conflicting metadata and pins the organization', async () => {
    const body = input();
    const [a, b] = await Promise.all([service.create(org, 'actor', body), service.create(org, 'actor', body)]);
    expect(a.id).toBe(b.id);
    expect(a.clientId).toBe(body.clientId);
    expect((await service.list(org)).sessions[0].clientId).toBe(body.clientId);
    await expect(service.create(org, 'actor', { ...body, manifest: ['f'.repeat(64)] })).rejects.toThrow('different file');
    await expect(service.create(other, 'actor', body)).rejects.toThrow('Organization changed');
  });
  it('ignores unwhitelisted HTTP fields and cannot attach another organization media', async () => {
    const foreignId = randomUUID();
    await db.media.create({ data: { id: foreignId, organizationId: other, name: 'foreign.mp4', path: '/uploads/foreign.mp4', type: 'video' } });
    const body = await new ValidationPipe({ transform: true }).transform({ ...input(), id: foreignId, mediaId: foreignId, status: 'COMPLETE', duration: 1, stagingCleaned: true, createdAt: new Date(0).toISOString() }, { type: 'body', metatype: CreateVideoUploadDto });
    const saved = await service.create(org, 'actor', body);
    expect(saved.id).not.toBe(foreignId); expect(saved.status).toBe('UPLOADING'); expect(saved.media).toBeNull();
    const row = await db.videoUploadSession.findUnique({ where: { id: saved.id } });
    expect(row.stagingCleaned).toBe(false); expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
  it('enforces organization and global quotas under competing admissions', async () => {
    const outcomes = await Promise.allSettled([service.create(org, 'actor', input()), service.create(org, 'actor', input())]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await service.create(other, 'actor', input(source, other));
    await expect(service.create(third, 'actor', input(source, third))).rejects.toThrow('limit');
  });
  it('isolates every session operation across organizations', async () => {
    const session = await service.create(org, 'actor', input());
    await expect(service.get(other, session.id)).rejects.toThrow('not found');
    await expect(service.part(other, session.id, 0, Readable.from(source))).rejects.toThrow('not found');
    await expect(service.complete(other, session.id)).rejects.toThrow('not found');
    await expect(service.cancel(other, session.id)).rejects.toThrow('not found');
    expect((await service.list(other)).sessions).toEqual([]);
  });
  it('accepts duplicate chunks once and rejects conflicting bytes or missing parts', async () => {
    const session = await service.create(org, 'actor', input());
    await expect(service.complete(org, session.id)).rejects.toThrow('missing');
    await service.part(org, session.id, 0, Readable.from(source), String(source.length));
    await service.part(org, session.id, 0, Readable.from(source));
    expect((await service.get(org, session.id)).parts).toHaveLength(1);
    const corrupt = Buffer.from(source); corrupt[100] ^= 1;
    await expect(service.part(org, session.id, 0, Readable.from(corrupt))).rejects.toThrow('content');
    await expect(service.part(org, session.id, 1, Readable.from(source))).rejects.toThrow('index');
    await expect(service.part(org, session.id, 0, Readable.from(Buffer.concat([source, source])))).rejects.toThrow('size');
  });
  it('retains receipts across restart and finalizes atomically to one media record', async () => {
    const session = await service.create(org, 'actor', input());
    await service.part(org, session.id, 0, Readable.from(source));
    service = new ResumableUploadService(db);
    const saved = await service.complete(org, session.id);
    expect(saved.media.id).toBe(session.id);
    expect((await service.complete(org, session.id)).media.id).toBe(session.id);
    expect(await db.media.count({ where: { organizationId: org } })).toBe(1);
    expect((await readFile(join(root, 'videos', session.id + '.mp4'))).equals(source)).toBe(true);
    await service.maintain();
    expect(await stat(join(root, 'videos', session.id + '.mp4'))).toBeDefined();
    expect((await service.get(org, session.id)).status).toBe('COMPLETE');
  });
  it('recovers final rename followed by database rollback without recreating media', async () => {
    const session = await service.create(org, 'actor', input());
    await service.part(org, session.id, 0, Readable.from(source));
    const original = (db.$transaction as any).bind(db);
    const spy = jest.spyOn(db, '$transaction').mockImplementation(((work: any, options: any) => original(async (tx: any) => {
      return work(new Proxy(tx, { get(target, property) {
        if (property === 'media') return new Proxy(target.media, { get(model, key) { if (key === 'upsert') return () => { throw new Error('simulated lost commit'); }; return model[key]; } });
        return target[property];
      } }));
    }, options)) as any);
    await expect(service.complete(org, session.id)).rejects.toThrow('lost commit'); spy.mockRestore();
    expect(await db.media.count({ where: { organizationId: org } })).toBe(0);
    expect(await stat(join(root, 'videos', session.id + '.mp4'))).toBeDefined();
    service = new ResumableUploadService(db); await service.maintain();
    expect((await service.get(org, session.id)).status).toBe('COMPLETE');
    expect(await db.media.count({ where: { organizationId: org } })).toBe(1);
  });
  it('recovers a stale FINALIZING claim without any browser and fences older generations', async () => {
    const session = await service.create(org, 'actor', input()); await service.part(org, session.id, 0, Readable.from(source));
    const old = await db.videoUploadSession.update({ where: { id: session.id }, data: { status: 'FINALIZING', leaseToken: randomUUID(), leaseUntil: new Date(0), expiresAt: new Date(0), generation: 1 } });
    await service.maintain(); expect((await service.get(org, session.id)).status).toBe('COMPLETE');
    await expect((service as any).locked((tx: any) => (service as any).fence(tx, old))).rejects.toThrow('expired');
  });
  it('keeps interrupted chunks unacknowledged and safely resumes', async () => {
    const session = await service.create(org, 'actor', input());
    const stream = new PassThrough(); const attempt = service.part(org, session.id, 0, stream);
    setTimeout(() => { stream.write(source.subarray(0, 100)); stream.destroy(new Error('disconnect')); }, 25);
    await expect(attempt).rejects.toThrow('disconnect');
    expect((await service.get(org, session.id)).parts).toEqual([]);
    await service.part(org, session.id, 0, Readable.from(source));
    expect((await service.complete(org, session.id)).status).toBe('COMPLETE');
  });
  it('cleans only expired incomplete staging and rejects later resumption', async () => {
    const session = await service.create(org, 'actor', input()); await service.part(org, session.id, 0, Readable.from(source));
    await db.videoUploadSession.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
    await service.maintain();
    expect((await service.get(org, session.id)).status).toBe('EXPIRED');
    await expect(service.part(org, session.id, 0, Readable.from(source))).rejects.toThrow('expired');
    await expect(stat(join(root, '.resumable', session.id))).rejects.toThrow();
  });
  it('streams a valid file above 100 MiB using only 8 MiB part requests', async () => {
    const path = join(root, 'large-fixture.mp4'); await writeFile(path, source);
    const extra = 101 * 1024 * 1024; const atom = Buffer.alloc(8); atom.writeUInt32BE(extra, 0); atom.write('free', 4);
    const handle = await open(path, 'r+'); await handle.write(atom, 0, 8, source.length); await handle.truncate(source.length + extra); await handle.close();
    const info = await stat(path); const manifest: string[] = [];
    for (let offset = 0; offset < info.size; offset += VIDEO_CHUNK_BYTES) {
      const hash = createHash('sha256'); for await (const chunk of createReadStream(path, { start: offset, end: Math.min(info.size, offset + VIDEO_CHUNK_BYTES) - 1 })) hash.update(chunk); manifest.push(hash.digest('hex'));
    }
    const session = await service.create(org, 'actor', { organizationId: org, clientId: randomUUID(), originalName: 'large.mp4', byteSize: info.size, manifest });
    for (let index = 0; index < manifest.length; index++) {
      const length = Math.min(VIDEO_CHUNK_BYTES, info.size - index * VIDEO_CHUNK_BYTES);
      expect(length).toBeLessThanOrEqual(VIDEO_CHUNK_BYTES);
      await service.part(org, session.id, index, createReadStream(path, { start: index * VIDEO_CHUNK_BYTES, end: index * VIDEO_CHUNK_BYTES + length - 1 }), String(length));
    }
    expect((await service.complete(org, session.id)).status).toBe('COMPLETE');
  });
  it('rejects low storage and respects live request/finalizer claims', async () => {
    const fs = require('fs/promises'); const space = jest.spyOn(fs, 'statfs').mockResolvedValue({ bavail: 1, bsize: 4096 } as any);
    await expect(service.create(org, 'actor', input())).rejects.toThrow('storage is full'); space.mockRestore();
    const session = await service.create(org, 'actor', input());
    await db.videoUploadSession.update({ where: { id: session.id }, data: { leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) } });
    await expect(service.part(org, session.id, 0, Readable.from(source))).rejects.toThrow('still running');
    await expect(service.cancel(org, session.id)).rejects.toThrow('current request');
  });
  it('validates a real HEVC MOV and rejects truncation without creating media', async () => {
    const path = join(root, 'hevc.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=64x64:rate=1', '-t', '2', '-c:v', 'libx265', '-threads', '1', '-x265-params', 'pools=1:frame-threads=1:log-level=error', '-tag:v', 'hvc1', '-y', path], { timeout: 30_000 });
    const bytes = (await stat(path)).size;
    expect((await validateVideoOnDisk(path, bytes)).mime).toBe('video/quicktime');
    const corrupt = source.subarray(0, Math.floor(source.length / 2));
    const session = await service.create(org, 'actor', input(corrupt)); await service.part(org, session.id, 0, Readable.from(corrupt));
    await expect(service.complete(org, session.id)).rejects.toThrow();
    expect(await db.media.count({ where: { organizationId: org } })).toBe(0);
    expect((await service.get(org, session.id)).status).toBe('FAILED');
  });
  it.each([600, 601])('validates a real %s-second video on disk', async seconds => {
    const path = join(root, `duration-${seconds}.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:rate=1', '-t', String(seconds), '-c:v', 'libx264', '-threads', '1', '-y', path], { timeout: 30_000 });
    const bytes = (await stat(path)).size;
    if (seconds === 600) expect((await validateVideoOnDisk(path, bytes)).duration).toBe(600);
    else await expect(validateVideoOnDisk(path, bytes)).rejects.toThrow('600');
  });
});
