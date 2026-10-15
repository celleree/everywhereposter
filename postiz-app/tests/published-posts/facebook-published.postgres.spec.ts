jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { FacebookPublishedService } from '../../libraries/nestjs-libraries/src/database/prisma/posts/facebook-published.service';
import { PostsRepository } from '../../libraries/nestjs-libraries/src/database/prisma/posts/posts.repository';
import { HistoricalImportRepository } from '../../libraries/nestjs-libraries/src/database/prisma/historical-imports/historical-import.repository';
const url = process.env.EP_SUBMISSION_TEST_DATABASE_URL;
if (url && url !== 'postgresql://isolated:isolated@127.0.0.1:55462/isolated')
  throw new Error(
    'Only the explicitly provisioned loopback fixture database is allowed.'
  );
const describeDatabase = url ? describe : describe.skip;
const originalFetch = global.fetch;
describeDatabase(
  'Facebook mutations with real PostgreSQL and mocked Graph only',
  () => {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: url || 'postgresql://isolated:isolated@127.0.0.1:55462/isolated',
        },
      },
    });
    const service = new FacebookPublishedService(prisma as any);
    const models = { model: prisma } as any;
    const posts = new PostsRepository(
      models,
      models,
      models,
      models,
      models,
      models
    );
    const historical = new HistoricalImportRepository(
      models,
      models,
      models,
      models
    );
    let org: string,
      integration: string,
      post: string,
      ledger: string,
      remote: string;
    let calls: string[], remoteMessage: string;
    let pause: (() => Promise<void>) | undefined;
    beforeAll(() => prisma.$connect());
    afterAll(() => prisma.$disconnect());
    afterEach(() => {
      global.fetch = originalFetch;
      jest.restoreAllMocks();
    });
    beforeEach(async () => {
      process.env.FACEBOOK_APP_ID = 'fixture-app';
      org = randomUUID();
      integration = randomUUID();
      post = randomUUID();
      ledger = randomUUID();
      remote = `123_${Date.now()}`;
      calls = [];
      remoteMessage = 'Original';
      pause = undefined;
      await prisma.organization.create({
        data: { id: org, name: 'Disposable Facebook mutation fixture' },
      });
      await prisma.integration.create({
        data: {
          id: integration,
          organizationId: org,
          internalId: '123',
          name: 'Fixture Page',
          providerIdentifier: 'facebook',
          type: 'social',
          token: 'fixture-no-real-credential',
        },
      });
      await prisma.post.create({
        data: {
          id: post,
          organizationId: org,
          integrationId: integration,
          state: 'PUBLISHED',
          content: 'Original',
          group: randomUUID(),
          publishDate: new Date(),
          releaseId: remote,
          releaseURL: `https://www.facebook.com/${remote}`,
          image: '[]',
          settings: '{"__type":"facebook"}',
        },
      });
      const submission = await prisma.publishingSubmission.create({
        data: {
          organizationId: org,
          attemptId: randomUUID(),
          contentHash: 'fixture',
        },
      });
      await prisma.publishingSubmissionDestination.create({
        data: {
          id: ledger,
          submissionId: submission.id,
          integrationId: integration,
          postId: post,
          providerState: 'SUCCEEDED',
          providerResult: [
            {
              id: post,
              postId: remote,
              status: 'success',
              releaseURL: `https://www.facebook.com/${remote}`,
              facebookText: {
                version: 1,
                appId: 'fixture-app',
                pageId: '123',
                message: 'Original',
                revision: 0,
                mutation: null,
              },
            },
          ],
        },
      });
      global.fetch = jest.fn(async (_url, init) => {
        const method = init?.method || 'GET';
        calls.push(method);
        if (method !== 'GET') await pause?.();
        if (method === 'POST')
          remoteMessage = JSON.parse(String(init?.body)).message;
        return {
          ok: true,
          json: async () =>
            method === 'GET'
              ? { id: remote, message: remoteMessage }
              : { success: true },
        } as Response;
      });
    });
    it('keeps multi-destination receipts read-only without touching either post or Graph', async () => {
      const original =
        await prisma.publishingSubmissionDestination.findUniqueOrThrow({
          where: { id: ledger },
        });
      const siblingIntegration = await prisma.integration.create({
        data: {
          id: randomUUID(),
          organizationId: org,
          internalId: '124',
          name: 'Second fixture Page',
          providerIdentifier: 'facebook',
          type: 'social',
          token: 'fixture-no-real-credential',
        },
      });
      const sibling = await prisma.post.create({
        data: {
          id: randomUUID(),
          organizationId: org,
          integrationId: siblingIntegration.id,
          group: randomUUID(),
          state: 'PUBLISHED',
          content: 'Sibling',
          publishDate: new Date(),
          image: '[]',
          settings: '{"__type":"facebook"}',
          releaseId: '124_555',
          releaseURL: 'https://www.facebook.com/124_555',
        },
      });
      const receipt = (original.providerResult as any[])[0];
      await prisma.publishingSubmissionDestination.create({
        data: {
          submissionId: original.submissionId,
          integrationId: siblingIntegration.id,
          postId: sibling.id,
          providerState: 'SUCCEEDED',
          providerResult: [
            {
              ...receipt,
              id: sibling.id,
              postId: '124_555',
              releaseURL: sibling.releaseURL,
              facebookText: {
                ...receipt.facebookText,
                pageId: '124',
                message: 'Sibling',
              },
            },
          ],
        },
      });
      for (const target of [post, sibling.id]) {
        await expect(service.status(org, target)).resolves.toMatchObject({
          eligible: false,
        });
        for (const action of ['edit', 'delete'] as const) {
          await expect(
            service.mutate(org, target, {
              action,
              revision: 0,
              ...(action === 'edit' ? { message: 'Edited' } : {}),
            })
          ).rejects.toThrow('Only new');
        }
      }
      expect(calls).toEqual([]);
      expect(
        await prisma.post.findUnique({ where: { id: post } })
      ).toMatchObject({ state: 'PUBLISHED', content: 'Original' });
      expect(
        await prisma.post.findUnique({ where: { id: sibling.id } })
      ).toMatchObject({ state: 'PUBLISHED', content: 'Sibling' });
      expect(
        (
          await prisma.publishingSubmissionDestination.findUniqueOrThrow({
            where: { id: ledger },
          })
        ).providerResult
      ).toEqual(original.providerResult);
    });
    it('allows only one winner across separate service instances and stale edit/delete requests', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      pause = () => gate;
      const first = service.mutate(org, post, {
        action: 'edit',
        revision: 0,
        message: 'Edited',
      });
      while (!calls.includes('POST'))
        await new Promise((resolve) => setTimeout(resolve, 5));
      const secondWorker = new FacebookPublishedService(prisma as any);
      await expect(
        secondWorker.mutate(org, post, { action: 'delete', revision: 0 })
      ).rejects.toThrow('reconciliation');
      expect(
        (await prisma.post.findUnique({ where: { id: post } }))?.content
      ).toBe('Original');
      release();
      await expect(first).resolves.toMatchObject({
        revision: 1,
        message: 'Edited',
      });
      await expect(
        secondWorker.mutate(org, post, {
          action: 'edit',
          revision: 0,
          message: 'Stale',
        })
      ).rejects.toThrow('changed');
      expect(calls.filter((method) => method !== 'GET')).toEqual(['POST']);
    });
    it('atomically rolls back local finalization and reconciles from durable success without another Graph call', async () => {
      const transaction = jest
        .spyOn(prisma, '$transaction')
        .mockRejectedValueOnce(new Error('fixture local write failure'));
      await expect(
        service.mutate(org, post, { action: 'delete', revision: 0 })
      ).rejects.toThrow('reconciliation');
      const stored = await prisma.publishingSubmissionDestination.findUnique({
        where: { id: ledger },
      });
      expect(
        (stored?.providerResult as any)[0].facebookText.mutation.phase
      ).toBe('CONFIRMED');
      expect(
        (await prisma.post.findUnique({ where: { id: post } }))?.state
      ).toBe('PUBLISHED');
      const count = calls.length;
      transaction.mockRestore();
      await expect(service.reconcile(org, post)).resolves.toMatchObject({
        deleted: true,
      });
      expect(calls).toHaveLength(count);
    });
    it('preserves delete tombstones against workflow replay and historical import', async () => {
      await service.mutate(org, post, { action: 'delete', revision: 0 });
      expect(
        await posts.updatePost(
          post,
          remote,
          `https://www.facebook.com/${remote}`
        )
      ).toMatchObject({ count: 0 });
      const source = await prisma.historicalImportSource.create({
        data: {
          organizationId: org,
          platform: 'facebook',
          platformAccountId: '123',
        },
      });
      const item = await historical.upsertHistoricalPost({
        organizationId: org,
        sourceId: source.id,
        platform: 'facebook',
        platformAccountId: '123',
        platformPostId: remote,
        publishedAt: new Date(),
      } as any);
      expect(item.deletedOrUnavailableAt).not.toBeNull();
      const again = await historical.upsertHistoricalPost({
        organizationId: org,
        sourceId: source.id,
        platform: 'facebook',
        platformAccountId: '123',
        platformPostId: remote,
        publishedAt: new Date(),
        deletedOrUnavailableAt: null,
      } as any);
      expect(again.deletedOrUnavailableAt).not.toBeNull();
    });
    it('serializes historical import with deletion so stale imports cannot resurrect the post', async () => {
      const source = await prisma.historicalImportSource.create({
        data: {
          organizationId: org,
          platform: 'facebook',
          platformAccountId: '123',
        },
      });
      await Promise.all([
        historical.upsertHistoricalPost({
          organizationId: org,
          sourceId: source.id,
          platform: 'facebook',
          platformAccountId: '123',
          platformPostId: remote,
          publishedAt: new Date(),
          deletedOrUnavailableAt: null,
        } as any),
        service.mutate(org, post, { action: 'delete', revision: 0 }),
      ]);
      const imported = await prisma.historicalPost.findFirst({
        where: { organizationId: org, platformPostId: remote },
      });
      expect(imported?.deletedOrUnavailableAt).not.toBeNull();
    });
    it('blocks legacy create/upsert attempts to modify the ledger-bound post', async () => {
      await expect(
        posts.createOrUpdatePost(
          'draft',
          org,
          new Date().toISOString(),
          {
            integration: { id: integration },
            value: [{ id: post, content: 'Tampered', image: [], delay: 0 }],
            settings: { __type: 'facebook' },
          } as any,
          []
        )
      ).rejects.toThrow('immutable');
      expect(
        (await prisma.post.findUnique({ where: { id: post } }))?.content
      ).toBe('Original');
      expect(calls).toEqual([]);
    });
  }
);
