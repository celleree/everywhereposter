import { PrismaService } from '../../libraries/nestjs-libraries/src/database/prisma/prisma.service';
import { ResumableUploadService } from '../../libraries/nestjs-libraries/src/upload/resumable-upload.service';
import { QuickUploadService, quickUploadVideoReason } from '../../libraries/nestjs-libraries/src/upload/quick-upload.service';
import { randomUUID, createHash } from 'crypto';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';

jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/copy-generation/copy-generation.service', () => ({ CopyGenerationService: class {} }));
jest.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({ PermissionsService: class {} }));
const url = process.env.EP_UPLOAD_TEST_DATABASE_URL;
if (url && url !== 'postgresql://isolated:isolated@127.0.0.1:55463/isolated') throw new Error('Only the disposable fixture URL is allowed.');
const suite = url ? describe : describe.skip;
suite('durable Quick Upload (real local ledger; provider/copy mocks)', () => {
  const org = 'quick-fixture-org', other = 'quick-fixture-other', actor = 'quick-fixture-user';
  let db: PrismaService, uploads: ResumableUploadService, service: QuickUploadService, root: string, source: Buffer;
  let start: jest.Mock, generate: jest.Mock, submit: jest.Mock, prepareCopy: jest.Mock, reconcile: jest.Mock, permissions: jest.Mock, copyResult: any;
  const instantiate = () => new QuickUploadService(db, uploads, { ensureTranscriptionStarted: prepareCopy } as any, { generate } as any,
    { mapTypeToPost: async (value: any) => value, createPost: submit, reconcileSubmission: reconcile } as any,
    { check: permissions } as any, { client: { getRawClient: () => ({ workflow: { start } }) } } as any, { getSocialIntegration: () => ({ getPublishedCapabilities: () => ({ requiresReconnect: false }) }) } as any);
  const consent = { confirmNoIndividualReview: true as const, destinations: [{ id: 'quick-fixture-x', settings: { who_can_reply_post: 'everyone' } }] };
  const session = () => uploads.create(org, actor, { organizationId: org, clientId: randomUUID(), originalName: 'fixture.mp4', byteSize: source.length, manifest: [createHash('sha256').update(source).digest('hex')] });
  const finish = async (id: string) => { await uploads.part(org, id, 0, Readable.from(source)); await uploads.complete(org, id); };
  beforeAll(async () => {
    process.env.DATABASE_URL = url; process.env.STORAGE_PROVIDER = 'local'; process.env.ENABLE_DURABLE_QUICK_UPLOAD = 'true'; process.env.FRONTEND_URL = 'http://fixture.invalid';
    root = await mkdtemp(join(tmpdir(), 'ep-quick-fixture-')); process.env.UPLOAD_DIRECTORY = root;
    db = new PrismaService(); await db.$connect(); uploads = new ResumableUploadService(db);
    for (const id of [org, other]) await db.organization.create({ data: { id, name: id } });
    await db.user.create({ data: { id: actor, email: 'quick@fixture.invalid', providerName: 'LOCAL', timezone: 0 } });
    await db.userOrganization.create({ data: { userId: actor, organizationId: org, role: 'ADMIN' } });
    await db.integration.create({ data: { id: 'quick-fixture-x', organizationId: org, internalId: 'fixture-x', name: 'Fixture X', providerIdentifier: 'x', type: 'social', token: 'fixture-not-a-token' } });
    source = await readFile(resolve('tests/browser/assets/synthetic-picker.mp4'));
  });
  beforeEach(async () => {
    await db.quickUploadIntent.deleteMany({ where: { organizationId: org } });
    await db.videoUploadPart.deleteMany({ where: { session: { organizationId: org } } });
    await db.videoUploadSession.deleteMany({ where: { organizationId: org } });
    await db.media.deleteMany({ where: { organizationId: org } });
    await db.userOrganization.updateMany({ where: { userId: actor }, data: { role: 'ADMIN', disabled: false } });
    await db.integration.update({ where: { id: 'quick-fixture-x' }, data: { refreshNeeded: false } });
    process.env.ENABLE_DURABLE_QUICK_UPLOAD = 'true';
    copyResult = { status: 'completed', warnings: [], sourceConfidence: .9, results: [{ platform: 'x', draft: 'Grounded fixture caption.', origin: 'generated', warnings: [] }] };
    start = jest.fn().mockResolvedValue({}); submit = jest.fn().mockResolvedValue({}); prepareCopy = jest.fn().mockResolvedValue({ status: 'READY' });
    generate = jest.fn(async function* () { yield { name: 'completed', data: copyResult }; });
    permissions = jest.fn().mockResolvedValue({ can: () => true });
    reconcile = jest.fn().mockResolvedValue({ destinations: [{ integrationId: 'quick-fixture-x', postId: 'reserved-post', state: 'published' }] });
    service = instantiate();
  });
  afterAll(async () => {
    await db.quickUploadIntent.deleteMany({ where: { organizationId: org } }); await db.videoUploadPart.deleteMany({ where: { session: { organizationId: org } } });
    await db.videoUploadSession.deleteMany({ where: { organizationId: org } }); await db.media.deleteMany({ where: { organizationId: org } });
    await db.integration.deleteMany({ where: { organizationId: org } }); await db.userOrganization.deleteMany({ where: { userId: actor } }); await db.user.delete({ where: { id: actor } });
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } }); await db.$disconnect(); await rm(root, { recursive: true, force: true });
  });
  it('persists consent during transfer, never processes incomplete media, resumes after browser disconnect', async () => {
    const upload = await session(); const intent = await service.enroll(org, actor, upload.id, consent);
    expect(upload.status).toBe('UPLOADING'); expect(await service.prepare(intent.id)).toBe('WAIT'); expect(generate).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    await finish(upload.id); service = instantiate();
    expect(await service.prepare(intent.id)).toBe('READY'); await service.generate(intent.id); await service.submit(intent.id);
    expect((await service.status(org, upload.id)).results).toEqual([expect.objectContaining({ state: 'Published' })]); expect(submit).toHaveBeenCalledTimes(1);
  });
  it('finalizes when the browser disappears after its last chunk receipt', async () => {
    const upload = await session(), intent = await service.enroll(org, actor, upload.id, consent);
    await uploads.part(org, upload.id, 0, Readable.from(source));
    expect(await service.prepare(intent.id)).toBe('WAIT'); expect((await uploads.get(org, upload.id)).status).toBe('COMPLETE');
    expect(await service.prepare(intent.id)).toBe('READY');
  });
  it('supports delayed consent after transfer and enforces immutable settings and org isolation', async () => {
    const upload = await session(); await finish(upload.id); const intent = await service.enroll(org, actor, upload.id, consent);
    expect((await service.enroll(org, actor, upload.id, consent)).id).toBe(intent.id); expect(await db.quickUploadIntent.count({ where: { sessionId: upload.id } })).toBe(1);
    await expect(service.enroll(org, actor, upload.id, { ...consent, destinations: [{ id: 'quick-fixture-x', settings: { who_can_reply_post: 'following' } }] })).rejects.toThrow('immutable');
    await expect(service.enroll(other, actor, upload.id, consent)).rejects.toThrow('not found'); await expect(service.status(other, upload.id)).rejects.toThrow('not found'); await expect(service.cancel(other, actor, upload.id)).rejects.toThrow('not found');
  });
  it('retains an outbox on Temporal outage and dispatches one stable job later', async () => {
    start.mockRejectedValue(new Error('unavailable')); const upload = await session(), intent = await service.enroll(org, actor, upload.id, consent);
    expect((await db.quickUploadIntent.findUnique({ where: { id: intent.id } })).dispatched).toBe(false);
    start.mockResolvedValue({}); service = instantiate(); await service.drain(); await service.drain();
    expect(start.mock.calls.every(call => call[1].workflowId === `quick-upload-${intent.id}`)).toBe(true); expect(start).toHaveBeenCalledTimes(2);
  });
  it('does not repeat generated work or change a saved #164 submission after restart', async () => {
    const upload = await session(), intent = await service.enroll(org, actor, upload.id, consent); await finish(upload.id); await service.prepare(intent.id);
    await Promise.allSettled([service.generate(intent.id), service.generate(intent.id)]); expect(generate).toHaveBeenCalledTimes(1);
    submit.mockRejectedValueOnce(new Error('lost ledger acknowledgement')); await expect(service.submit(intent.id)).rejects.toThrow();
    service = instantiate(); await service.generate(intent.id); await service.submit(intent.id);
    expect(generate).toHaveBeenCalledTimes(1); expect(submit.mock.calls[0][1]).toEqual(submit.mock.calls[1][1]); expect(submit.mock.calls[1][1].submissionId).toBe(`quick_${intent.id}`);
  });
  it('never repeats ambiguous generation and records per-destination failures', async () => {
    const upload = await session(), intent = await service.enroll(org, actor, upload.id, consent); await finish(upload.id); await service.prepare(intent.id);
    generate.mockImplementation(async function* () { throw new Error('lost provider reply'); }); await expect(service.generate(intent.id)).rejects.toThrow();
    await expect(service.generate(intent.id)).rejects.toThrow('uncertain'); await service.fail(intent.id);
    expect(generate).toHaveBeenCalledTimes(1); expect(submit).not.toHaveBeenCalled(); expect((await service.status(org, upload.id)).results).toEqual([expect.objectContaining({ state: 'Failed' })]);
  });
  it('retains uncertain publishing outcomes without a resend', async () => {
    const upload = await session(), intent = await service.enroll(org, actor, upload.id, consent); await finish(upload.id); await service.prepare(intent.id); await service.generate(intent.id);
    reconcile.mockResolvedValue({ destinations: [{ integrationId: 'quick-fixture-x', postId: 'reserved-post', state: 'uncertain', providerState: 'UNCERTAIN' }] }); await service.submit(intent.id); await service.reconcile(intent.id);
    expect(submit).toHaveBeenCalledTimes(1); expect((await service.status(org, upload.id)).results).toEqual([expect.objectContaining({ state: 'Failed', reason: expect.stringContaining('not be retried') })]);
  });
  it('keeps IN_FLIGHT under observation until its provider receipt succeeds without another submit', async () => {
    const upload = await session(), intent = await service.enroll(org, actor, upload.id, consent); await finish(upload.id); await service.prepare(intent.id); await service.generate(intent.id);
    reconcile.mockResolvedValue({ destinations: [{ integrationId: 'quick-fixture-x', postId: 'reserved-post', state: 'uncertain', providerState: 'IN_FLIGHT' }] });
    await service.submit(intent.id); expect((await service.status(org, upload.id)).status).toBe('PUBLISHING'); expect(await service.reconcile(intent.id)).toBe(false);
    service = instantiate(); reconcile.mockResolvedValue({ destinations: [{ integrationId: 'quick-fixture-x', postId: 'reserved-post', state: 'published', providerState: 'SUCCEEDED' }] });
    expect(await service.reconcile(intent.id)).toBe(true); expect((await service.status(org, upload.id)).results).toEqual([expect.objectContaining({ state: 'Published' })]); expect(submit).toHaveBeenCalledTimes(1);
  });
  it('skips content needing review and rechecks actor and account eligibility', async () => {
    const upload = await session(), intent = await service.enroll(org, actor, upload.id, consent); await finish(upload.id); await service.prepare(intent.id);
    copyResult.warnings = [{ code: 'UNGROUNDED', message: 'review' }]; await service.generate(intent.id); await service.submit(intent.id); expect(submit).not.toHaveBeenCalled();
    expect((await service.status(org, upload.id)).results).toEqual([expect.objectContaining({ state: 'Skipped' })]);
  });
  it('blocks revoked permissions, requires consent, and keeps the feature disabled by default', async () => {
    const upload = await session(); await expect(service.enroll(org, actor, upload.id, { ...consent, confirmNoIndividualReview: false } as any)).rejects.toThrow('consent');
    process.env.ENABLE_DURABLE_QUICK_UPLOAD = 'false'; await expect(service.enroll(org, actor, upload.id, consent)).rejects.toThrow('not enabled'); process.env.ENABLE_DURABLE_QUICK_UPLOAD = 'true';
    const intent = await service.enroll(org, actor, upload.id, consent); await finish(upload.id); await db.userOrganization.updateMany({ where: { userId: actor }, data: { role: 'USER' } });
    await expect(service.prepare(intent.id)).rejects.toThrow('permission'); expect(generate).not.toHaveBeenCalled();
  });
  it('cancels before processing and rejects cancellation after the processing claim', async () => {
    const upload = await session(), intent = await service.enroll(org, actor, upload.id, consent); await service.cancel(org, actor, upload.id); await finish(upload.id);
    expect(await service.prepare(intent.id)).toBe('DONE'); expect(generate).not.toHaveBeenCalled();
  });
});
it.each([['x', 141, {}, [], true], ['x', 600, {}, [{ title: 'Verified', value: true }], false], ['threads', 301, {}, [], true], ['instagram', 61, { post_type: 'story' }, [], true], ['instagram', 181, { post_type: 'reel' }, [], true], ['linkedin', 1, { post_as_images_carousel: true }, [], true]] as any[])('preserves %s video restrictions', (platform, duration, settings, additional, skipped) => expect(!!quickUploadVideoReason(platform, duration, settings, additional)).toBe(skipped));
