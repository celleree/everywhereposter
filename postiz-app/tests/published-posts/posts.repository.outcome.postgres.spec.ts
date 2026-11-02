import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PostsRepository } from '../../libraries/nestjs-libraries/src/database/prisma/posts/posts.repository';
import { PublishingSubmissionService } from '../../libraries/nestjs-libraries/src/database/prisma/posts/publishing-submission.service';

const url = process.env.EP_SUBMISSION_TEST_DATABASE_URL;
if (url && url !== 'postgresql://isolated:isolated@127.0.0.1:55462/isolated') throw new Error('Only the exact disposable PostgreSQL fixture is allowed.');
const suite = url ? describe : describe.skip;
suite('idempotent post outcomes (isolated PostgreSQL; no providers)', () => {
  const db = new PrismaClient({ datasources: { db: { url: url || 'postgresql://isolated:isolated@127.0.0.1:55462/isolated' } } });
  const model = { model: db } as any;
  const repository = new PostsRepository(model, model, model, model, model, model);
  let org: string, integrationId: string, id: string;
  const remoteId = 'synthetic-provider-id', remoteURL = 'https://provider.invalid/synthetic';
  const row = () => db.post.findUniqueOrThrow({ where: { id } });
  beforeAll(() => db.$connect());
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    org = `outcome-${randomUUID()}`;
    integrationId = randomUUID();
    await db.organization.create({ data: { id: org, name: 'Outcome fixture' } });
    await db.integration.create({ data: {
      id: integrationId, organizationId: org, internalId: randomUUID(), name: 'Synthetic channel',
      providerIdentifier: 'x', type: 'social', token: 'synthetic-fixture-token',
    } });
    const post = await db.post.create({ data: {
      organizationId: org, integrationId, content: 'Synthetic post', group: randomUUID(),
      publishDate: new Date(), state: 'QUEUE', updatedAt: new Date('2020-01-01T00:00:00Z'),
    } });
    id = post.id;
  });

  it('writes the first success once and leaves the entire row unchanged on repeated success', async () => {
    expect(await repository.updatePost(id, remoteId, remoteURL)).toEqual({ count: 1 });
    const published = await row();
    expect(published).toMatchObject({ state: 'PUBLISHED', releaseId: remoteId, releaseURL: remoteURL, remoteDeletedAt: null });
    expect(await repository.updatePost(id, remoteId, remoteURL)).toEqual({ count: 0 });
    expect(await row()).toEqual(published);
  });

  it.each([
    [null, null], [null, remoteURL], [remoteId, null],
    ['older-id', remoteURL], [remoteId, 'https://provider.invalid/older'], ['', ''],
  ])('updates nullable or changed receipts (%s, %s)', async (releaseId, releaseURL) => {
    await db.post.update({ where: { id }, data: { state: 'PUBLISHED', releaseId, releaseURL } });
    expect(await repository.updatePost(id, remoteId, remoteURL)).toEqual({ count: 1 });
    expect(await row()).toMatchObject({ state: 'PUBLISHED', releaseId: remoteId, releaseURL: remoteURL });
    expect(await repository.updatePost(id, remoteId, remoteURL)).toEqual({ count: 0 });
  });

  it.each(['DRAFT', 'QUEUE', 'ERROR'] as const)('still transitions a legacy %s post with an otherwise identical receipt', async (state) => {
    await db.post.update({ where: { id }, data: { state, releaseId: remoteId, releaseURL: remoteURL, error: 'Existing diagnostic' } });
    expect(await repository.updatePost(id, remoteId, remoteURL)).toEqual({ count: 1 });
    expect(await row()).toMatchObject({ state: 'PUBLISHED', error: 'Existing diagnostic' });
  });

  it('clears a nonnull remote deletion timestamp even when the remaining success fields match', async () => {
    await db.post.update({ where: { id }, data: {
      state: 'PUBLISHED', releaseId: remoteId, releaseURL: remoteURL, remoteDeletedAt: new Date(), error: 'Existing diagnostic',
    } });
    expect(await repository.updatePost(id, remoteId, remoteURL)).toEqual({ count: 1 });
    const cleared = await row();
    expect(cleared).toMatchObject({ remoteDeletedAt: null, error: 'Existing diagnostic' });
    expect(await repository.updatePost(id, remoteId, remoteURL)).toEqual({ count: 0 });
    expect(await row()).toEqual(cleared);
  });

  it('preserves DELETED_REMOTE protection even when every success field would change', async () => {
    await db.post.update({ where: { id }, data: { state: 'DELETED_REMOTE', releaseId: null, releaseURL: null, remoteDeletedAt: new Date() } });
    const deleted = await row();
    expect(await repository.updatePost(id, remoteId, remoteURL)).toEqual({ count: 0 });
    expect(await row()).toEqual(deleted);
  });

  it('allows one actual row mutation for concurrent identical outcomes', async () => {
    const outcomes = await Promise.all([
      repository.updatePost(id, remoteId, remoteURL), repository.updatePost(id, remoteId, remoteURL), repository.updatePost(id, remoteId, remoteURL),
    ]);
    expect(outcomes.map(({ count }) => count).sort()).toEqual([0, 0, 1]);
    expect(await row()).toMatchObject({ state: 'PUBLISHED', releaseId: remoteId, releaseURL: remoteURL });
  });

  it('keeps the durable receipt commit mandatory and makes subsequent activity/replay bookkeeping a no-op', async () => {
    const submission = await db.publishingSubmission.create({ data: { organizationId: org, attemptId: randomUUID(), contentHash: 'synthetic-hash' } });
    await db.publishingSubmissionDestination.create({ data: { submissionId: submission.id, integrationId, postId: id } });
    const service = new PublishingSubmissionService(db as any, repository, {} as any);
    const receipt = [{ id, postId: remoteId, releaseURL: remoteURL, status: 'success' }];
    const provider = jest.fn(async () => receipt);
    const workflowId = `post_${id}_submission_1`;
    expect(await service.runProvider(org, id, integrationId, workflowId, provider)).toEqual(receipt);
    const committed = await row();
    expect(await db.publishingSubmissionDestination.findUnique({ where: { postId: id } })).toMatchObject({ providerState: 'SUCCEEDED', providerResult: receipt });
    expect(await repository.updatePost(id, remoteId, remoteURL)).toEqual({ count: 0 });
    expect(await service.runProvider(org, id, integrationId, workflowId, provider)).toEqual(receipt);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await row()).toEqual(committed);
  });

  it('keeps the existing zero-count result for a missing post', async () => {
    expect(await repository.updatePost('missing-fixture-post', remoteId, remoteURL)).toEqual({ count: 0 });
  });
});
