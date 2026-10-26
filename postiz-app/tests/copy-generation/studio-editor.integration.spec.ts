import { createHash, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { StudioEditRepository, normalizeStudioRequest } from '../../libraries/nestjs-libraries/src/media-editing/studio-edit.repository';
import { StudioEditService } from '../../libraries/nestjs-libraries/src/media-editing/studio-edit.service';
import { UploadFactory } from '../../libraries/nestjs-libraries/src/upload/upload.factory';
import { studioOutputKey } from '../../libraries/nestjs-libraries/src/upload/upload.interface';

const request = () => ({ requestKey: randomUUID(), sourceMediaId: 'source', brollMediaIds: ['broll'], destinations: ['threads'], profile: 'easy-graphics-v1' as const });
it.each([
  { brollMediaIds: ['broll', 'broll'] }, { sourceMediaId: '../source' }, { brollMediaIds: ['source'] },
  { destinations: [] }, { destinations: ['unknown'] }, { profile: 'arbitrary-code' }, { command: 'render' },
])('rejects unsupported or unbounded Studio input %j', change => {
  expect(() => normalizeStudioRequest({ ...request(), ...change } as any)).toThrow();
});
it('normalizes selected identifiers without modifying the caller', () => {
  const input = { ...request(), brollMediaIds: ['z', 'a'], destinations: ['threads', 'facebook'] };
  expect(normalizeStudioRequest(input).brollMediaIds).toEqual(['a', 'z']);
  expect(input.brollMediaIds).toEqual(['z', 'a']);
});
it('does not promote storage after an asset disappears during I/O', async () => {
  const store = jest.fn().mockResolvedValue({ key: 'staged' });
  const spy = jest.spyOn(UploadFactory, 'createStorage').mockReturnValue({ storeStudioOutput: store } as any);
  try {
    const jobs = { get: async () => ({ input: { media: [{ id: 'source', path: '/owned.mp4' }] } }),
      bindOutput: jest.fn().mockResolvedValue({}), recordStored: jest.fn() };
    const db = { media: { findMany: jest.fn().mockResolvedValueOnce([{ id: 'source', path: '/owned.mp4' }]).mockResolvedValueOnce([]) } };
    const service = new StudioEditService(jobs as any, db as any);
    await expect(service.storeOutput('owner', randomUUID(), 1, 'lease', '/synthetic', 'a'.repeat(64), 10)).rejects.toBeInstanceOf(NotFoundException);
    expect(store).toHaveBeenCalledTimes(1); expect(jobs.recordStored).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

const url = process.env.EP_STUDIO_TEST_DATABASE_URL;
if (url && url !== 'postgresql://isolated:isolated@127.0.0.1:55462/isolated') throw new Error('Studio tests require the explicitly disposable fixture');
const describeDatabase = url ? describe : describe.skip;
describeDatabase('Studio jobs on disposable PostgreSQL', () => {
  const db = new PrismaClient({ datasources: { db: { url: url || 'postgresql://isolated:isolated@127.0.0.1:55462/isolated' } } });
  const jobs = new StudioEditRepository(db as any);
  let org: string, input: ReturnType<typeof request>;
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    org = randomUUID(); await db.organization.create({ data: { id: org, name: 'Synthetic Studio organization' } });
    const source = await db.media.create({ data: { organizationId: org, name: 'source.mp4', path: '/source.mp4', type: 'video' } });
    const broll = await db.media.create({ data: { organizationId: org, name: 'broll.mp4', path: '/broll.mp4', type: 'video' } });
    input = { ...request(), sourceMediaId: source.id, brollMediaIds: [broll.id] };
  });
  it('admits concurrent identical requests once and never mutates their captured input', async () => {
    const rows = await Promise.all(Array.from({ length: 8 }, () => jobs.admit(org, input)));
    expect(new Set(rows.map(row => row.id)).size).toBe(1);
    expect(rows[0].state).toBe('ADMITTED');
    expect((rows[0].input as any).contentIdentity).toBe('UNVERIFIED_UNTIL_WORKER_HASHES_BYTES');
    await expect(jobs.admit(org, { ...input, destinations: ['facebook'] })).rejects.toBeInstanceOf(ConflictException);
    expect(await db.studioEditJob.count({ where: { organizationId: org } })).toBe(1);
  });
  it('rejects cross-organization and soft-deleted B-roll before creating a job', async () => {
    const another = await db.organization.create({ data: { name: 'Different fixture' } });
    const foreign = await db.media.create({ data: { organizationId: another.id, name: 'foreign', path: '/foreign.mp4', type: 'video' } });
    await expect(jobs.admit(org, { ...input, brollMediaIds: [foreign.id] })).rejects.toBeInstanceOf(NotFoundException);
    await db.media.update({ where: { id: input.brollMediaIds[0] }, data: { deletedAt: new Date() } });
    await expect(jobs.admit(org, input)).rejects.toBeInstanceOf(NotFoundException);
    expect(await db.studioEditJob.count({ where: { organizationId: org } })).toBe(0);
  });
  it('admits one claim and invalidates stale output completion after cancellation', async () => {
    const job = await jobs.admit(org, input);
    const claims = await Promise.allSettled([jobs.claim(org, job.id, 1), jobs.claim(org, job.id, 1)]);
    expect(claims.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const running = await jobs.get(org, job.id);
    const intent = await jobs.bindOutput(org, job.id, 1, running.leaseToken!, 'a'.repeat(64), 10);
    await jobs.cancel(org, job.id);
    await expect(jobs.recordStored(intent, running.leaseToken!, { key: studioOutputKey(intent), path: '/staged', sha256: intent.sha256, bytes: 10 })).rejects.toBeInstanceOf(ConflictException);
    expect((await jobs.get(org, job.id)).state).toBe('CANCELLED');
    await expect(jobs.get('another-org', job.id)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('replays one immutable stored intent but never creates a reviewed Media derivative', async () => {
    const job = await jobs.admit(org, input), running = await jobs.claim(org, job.id, 1);
    const hash = createHash('sha256').update('synthetic').digest('hex');
    const intent = await jobs.bindOutput(org, job.id, 1, running.leaseToken!, hash, 9);
    expect(await jobs.bindOutput(org, job.id, 1, running.leaseToken!, hash, 9)).toEqual(intent);
    await expect(jobs.bindOutput(org, job.id, 1, running.leaseToken!, hash, 10)).rejects.toBeInstanceOf(ConflictException);
    const receipt = { key: studioOutputKey(intent), path: '/verified-storage-object', sha256: hash, bytes: 9 };
    const stored = await jobs.recordStored(intent, running.leaseToken!, receipt);
    expect(await jobs.recordStored(intent, running.leaseToken!, receipt)).toEqual(stored);
    expect(stored.state).toBe('OUTPUT_STORED_UNVERIFIED');
    expect(await db.media.count({ where: { organizationId: org } })).toBe(2);
    await expect(db.media.delete({ where: { id: input.sourceMediaId } })).rejects.toThrow();
  });
});
