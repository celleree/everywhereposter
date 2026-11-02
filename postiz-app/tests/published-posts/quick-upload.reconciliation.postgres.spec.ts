jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/copy-generation/copy-generation.service', () => ({ CopyGenerationService: class {} }));
jest.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({ PermissionsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { QuickUploadService } from '../../libraries/nestjs-libraries/src/upload/quick-upload.service';

const url = process.env.EP_SUBMISSION_TEST_DATABASE_URL;
if (url && url !== 'postgresql://isolated:isolated@127.0.0.1:55462/isolated') throw new Error('Only the exact disposable PostgreSQL fixture is allowed.');
const suite = url ? describe : describe.skip;
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};
suite('Quick Upload reconciliation (isolated PostgreSQL; no providers)', () => {
  const db = new PrismaClient({ datasources: { db: { url: url || 'postgresql://isolated:isolated@127.0.0.1:55462/isolated' } } });
  let id: string, service: QuickUploadService, ledger: jest.Mock, update: jest.SpyInstance;
  const skipped = { integrationId: 'skip', name: 'Skipped channel', state: 'Skipped', reason: 'Use Customize.' };
  const destination = (integrationId: string, state = 'processing', providerState = 'READY') => ({ integrationId, postId: `post-${integrationId}`, state, providerState });
  const publishing = { destinations: [destination('b'), destination('a')] };
  const partial = { destinations: [destination('a', 'published', 'SUCCEEDED'), destination('b')] };
  const published = { destinations: [destination('a', 'published', 'SUCCEEDED'), destination('b', 'published', 'SUCCEEDED')] };
  const row = () => db.quickUploadIntent.findUniqueOrThrow({ where: { id } });
  const counts = async () => (await Promise.all(update.mock.results.map((result) => result.value))).map((result: any) => result.count);
  beforeAll(() => db.$connect());
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    const org = `reconcile-${randomUUID()}`;
    await db.organization.create({ data: { id: org, name: 'Reconciliation fixture' } });
    const session = await db.videoUploadSession.create({ data: {
      organizationId: org, creatorId: 'synthetic-actor', clientId: randomUUID(), originalName: 'synthetic.mp4',
      byteSize: 1, manifest: ['synthetic-manifest'], expiresAt: new Date(Date.now() + 60_000),
    } });
    const intent = await db.quickUploadIntent.create({ data: {
      sessionId: session.id, organizationId: org, actorId: 'synthetic-actor', actorRole: 'ADMIN', status: 'PUBLISHING',
      copyStartedAt: new Date(), generated: { synthetic: true }, submissionBody: { synthetic: true },
      destinations: [{ id: 'a', name: 'Channel A' }, { id: 'b', name: 'Channel B' }],
      results: [skipped], updatedAt: new Date('2020-01-01T00:00:00Z'),
    } });
    id = intent.id;
    ledger = jest.fn().mockResolvedValue(publishing);
    service = new QuickUploadService(db as any, {} as any, {} as any, {} as any,
      { reconcileSubmission: ledger } as any, {} as any, {} as any, {} as any);
    update = jest.spyOn(db.quickUploadIntent, 'updateMany');
  });
  afterEach(() => jest.restoreAllMocks());

  it('avoids mutations and timestamp refreshes despite object-key and ledger ordering', async () => {
    await db.quickUploadIntent.update({ where: { id }, data: { results: [skipped,
      { state: 'Publishing', postId: 'post-a', name: 'Channel A', integrationId: 'a' },
      { integrationId: 'b', name: 'Channel B', postId: 'post-b', state: 'Publishing' },
    ], updatedAt: new Date('2020-01-01T00:00:00Z') } });
    const before = await row();
    expect(await service.reconcile(id)).toBe(false);
    ledger.mockResolvedValue({ destinations: [...publishing.destinations].reverse() });
    expect(await service.reconcile(id)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(await row()).toEqual(before);
  });

  it('persists each real partial/terminal transition once and retains skipped destinations', async () => {
    expect(await service.reconcile(id)).toBe(false);
    const pending = await row();
    expect(await service.reconcile(id)).toBe(false);
    expect((await row()).updatedAt).toEqual(pending.updatedAt);
    ledger.mockResolvedValue(partial);
    expect(await service.reconcile(id)).toBe(false);
    ledger.mockResolvedValue(published);
    expect(await service.reconcile(id)).toBe(true);
    const complete = await row();
    expect(complete.status).toBe('COMPLETE');
    expect(complete.results).toEqual([skipped,
      { integrationId: 'a', name: 'Channel A', postId: 'post-a', state: 'Published' },
      { integrationId: 'b', name: 'Channel B', postId: 'post-b', state: 'Published' },
    ]);
    expect(await service.reconcile(id)).toBe(true);
    expect(await row()).toEqual(complete);
    expect(await counts()).toEqual([1, 1, 1]);
  });

  it.each(['COMPLETE', 'FAILED', 'CANCELLED'])('preserves an existing %s terminal result', async (status) => {
    await db.quickUploadIntent.update({ where: { id }, data: { status } });
    const before = await row();
    expect(await service.reconcile(id)).toBe(true);
    expect(ledger).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(await row()).toEqual(before);
  });

  it('allows just one physical transition when concurrent observers share a snapshot', async () => {
    const both = gate();
    let calls = 0;
    ledger.mockImplementation(async () => { if (++calls === 2) both.release(); await both.promise; return published; });
    expect(await Promise.all([service.reconcile(id), service.reconcile(id)])).toEqual([true, true]);
    expect((await counts()).sort()).toEqual([0, 1]);
    expect((await row()).status).toBe('COMPLETE');
    expect(ledger).toHaveBeenCalledTimes(2);
  });

  it.each(['partial', 'terminal'])('cannot overwrite a newer %s observation with stale pending results', async (newer) => {
    const entered = gate(), release = gate();
    ledger.mockImplementationOnce(async () => { entered.release(); await release.promise; return publishing; });
    ledger.mockResolvedValue(newer === 'partial' ? partial : published);
    const stale = service.reconcile(id);
    await entered.promise;
    expect(await service.reconcile(id)).toBe(newer === 'terminal');
    const committed = await row();
    release.release();
    expect(await stale).toBe(newer === 'terminal');
    expect(await row()).toEqual(committed);
    expect(await counts()).toEqual([1, 0]);
    expect(ledger).toHaveBeenCalledTimes(newer === 'partial' ? 3 : 2);
  });

  it.each(['FAILED', 'CANCELLED'])('does not reopen a concurrent %s transition', async (status) => {
    const entered = gate(), release = gate();
    ledger.mockImplementationOnce(async () => { entered.release(); await release.promise; return published; });
    const observing = service.reconcile(id);
    await entered.promise;
    await db.quickUploadIntent.update({ where: { id }, data: { status, message: 'Concurrent terminal state' } });
    const committed = await row();
    release.release();
    expect(await observing).toBe(true);
    expect(await row()).toEqual(committed);
    expect(await counts()).toEqual([0]);
  });

  it('bounds contention to one fresh retry and reports pending after both snapshots lose', async () => {
    let version = 0;
    ledger.mockImplementation(async () => {
      await db.quickUploadIntent.update({ where: { id }, data: { results: [{ ...skipped, reason: `Observer ${++version}` }] } });
      return published;
    });
    expect(await service.reconcile(id)).toBe(false);
    expect(ledger).toHaveBeenCalledTimes(2);
    expect(await counts()).toEqual([0, 0]);
    expect((await row()).results).toEqual([{ ...skipped, reason: 'Observer 2' }]);
    expect((await row()).status).toBe('PUBLISHING');
  });

  it('keeps IN_FLIGHT pending and records uncertainty without resubmission', async () => {
    ledger.mockResolvedValue({ destinations: [destination('a', 'uncertain', 'IN_FLIGHT')] });
    expect(await service.reconcile(id)).toBe(false);
    expect((await row()).results).toContainEqual(expect.objectContaining({ state: 'Publishing' }));
    ledger.mockResolvedValue({ destinations: [destination('a', 'uncertain', 'UNCERTAIN')] });
    expect(await service.reconcile(id)).toBe(true);
    expect((await row()).results).toContainEqual(expect.objectContaining({ state: 'Failed', reason: expect.stringContaining('not be retried') }));
  });

  it('continues observing existing work when new Quick Upload enrollment is disabled', async () => {
    const previous = process.env.ENABLE_DURABLE_QUICK_UPLOAD;
    process.env.ENABLE_DURABLE_QUICK_UPLOAD = 'false';
    try {
      expect(await service.reconcile(id)).toBe(false);
      expect(await counts()).toEqual([1]);
    } finally {
      if (previous === undefined) delete process.env.ENABLE_DURABLE_QUICK_UPLOAD;
      else process.env.ENABLE_DURABLE_QUICK_UPLOAD = previous;
    }
  });

  it('propagates an unavailable ledger without modifying saved observations', async () => {
    const before = await row();
    ledger.mockRejectedValue(new Error('Observation unavailable'));
    await expect(service.reconcile(id)).rejects.toThrow('Observation unavailable');
    expect(update).not.toHaveBeenCalled();
    expect(await row()).toEqual(before);
  });
});
