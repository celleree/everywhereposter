jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: jest.fn(() => ({
      uploadFile: jest.fn(),
    })),
  },
}));

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('@sentry/nestjs', () => ({
  metrics: {
    count: jest.fn(),
  },
}));

jest.mock('@gitroom/helpers/utils/strip.html.validation', () => ({
  stripHtmlValidation: jest.fn(
    (
      _editor: string,
      content: string
    ) => content
  ),
}));

jest.mock('sharp', () => {
  const sharp = jest.fn(() => ({
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn(),
  }));

  return {
    __esModule: true,
    default: sharp,
  };
});

jest.mock('bcrypt', () => ({
  compareSync: jest.fn(),
  hashSync: jest.fn(),
}));

jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PostsRepository } from '../../libraries/nestjs-libraries/src/database/prisma/posts/posts.repository';
import { PostsService } from '../../libraries/nestjs-libraries/src/database/prisma/posts/posts.service';
import { PostActivity } from '../../apps/orchestrator/src/activities/post.activity';

const url = process.env.EP_SUBMISSION_TEST_DATABASE_URL;
if (url && url !== 'postgresql://isolated:isolated@127.0.0.1:55462/isolated') {
  throw new Error('Atomic-save tests require the exact disposable PostgreSQL fixture.');
}
const suite = url ? describe : describe.skip;
suite('atomic legacy post saves (isolated PostgreSQL; no providers)', () => {
  const db = new PrismaClient({ datasources: { db: { url: url || 'postgresql://isolated:isolated@127.0.0.1:55462/isolated' } } });
  const model = { model: db } as any;
  const repository = new PostsRepository(model, model, model, model, model, model);
  let service: PostsService, org: string, body: any, before: any;
  let shortlinks: jest.Mock, start: jest.Mock, dispatch: jest.SpyInstance;
  let insideTransaction = false;
  let dispatchObservations: Array<{ inside: boolean; rows: number }>;
  const snapshot = () => db.post.findMany({ where: { organizationId: org }, include: { tags: true }, orderBy: { id: 'asc' } });
  beforeAll(() => db.$connect());
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    org = `atomic-${randomUUID()}`;
    await db.organization.create({ data: { id: org, name: 'Atomic-save fixture' } });
    const integrations = await Promise.all([0, 1].map((index) => db.integration.create({ data: {
      id: randomUUID(), organizationId: org, internalId: randomUUID(), name: `Fixture ${index}`,
      providerIdentifier: 'x', type: 'social', token: 'synthetic-fixture-token',
    } })));
    const oldTag = await db.tags.create({ data: { orgId: org, name: 'Old', color: '#000000' } });
    const newTag = await db.tags.create({ data: { orgId: org, name: 'New', color: '#ffffff' } });
    const date = new Date(Date.now() + 60 * 60_000).toISOString();
    const old = await repository.createOrUpdatePost('draft', org, date, {
      integration: { id: integrations[0].id }, settings: { __type: 'x' },
      value: [{ content: 'Original root', image: [] }, { content: 'Original child', image: [] }],
    } as any, [{ value: oldTag.id, label: oldTag.name }]);
    body = { type: 'schedule', date, shortLink: false, tags: [{ value: newTag.id, label: newTag.name }],
      posts: integrations.map(({ id }, index) => ({ integration: { id }, settings: { __type: 'x' },
        ...(index === 0 ? { group: old.posts[0].group } : {}),
        value: [{ ...(index === 0 ? { id: old.posts[0].id } : {}), content: 'Updated root', image: [] }, { content: 'New child', image: [] }],
      })),
    };
    shortlinks = jest.fn(async (_org, content) => content);
    dispatchObservations = [];
    start = jest.fn(async (_name, options) => {
      dispatchObservations.push({ inside: insideTransaction, rows: await db.post.count({ where: { organizationId: org, state: 'QUEUE', deletedAt: null } }) });
      return options.workflowId;
    });
    service = Object.assign(Object.create(PostsService.prototype), {
      _prisma: db, _postRepository: repository,
      _integrationService: { getIntegrationById: (organizationId, id) => db.integration.findFirst({ where: { organizationId, id } }) },
      _shortLinkService: { convertTextToShortLinks: shortlinks },
      _temporalService: { client: { getRawClient: () => ({ workflow: { list: () => [], start } }) } },
    });
    dispatch = jest.spyOn(service, 'startWorkflow');
    before = await snapshot();
  });
  afterEach(() => { jest.restoreAllMocks(); insideTransaction = false; });

  it.each(['root', 'child', 'tags', 'group', 'destination'])('rolls back all rows and dispatches nothing after a %s failure', async (stage) => {
    const transaction = db.$transaction.bind(db);
    jest.spyOn(db, '$transaction').mockImplementation(((work: any, options: any) => transaction(async (tx) => {
      let upserts = 0;
      const intercept = (delegate: any, method: string, shouldFail: (args: any) => boolean) => {
        const original = delegate[method].bind(delegate);
        jest.spyOn(delegate, method).mockImplementation(async (args) => {
          const result = await original(args);
          if (shouldFail(args)) throw new Error(`Injected ${stage} failure`);
          return result;
        });
      };
      intercept(tx.post, 'upsert', () => {
        upserts++;
        return (stage === 'root' && upserts === 1) || (stage === 'child' && upserts === 2) || (stage === 'destination' && upserts === 4);
      });
      intercept(tx.post, 'update', (args) => stage === 'tags' && !!args.data.tags);
      intercept(tx.post, 'updateMany', (args) => stage === 'group' && !!args.data.deletedAt);
      return work(tx);
    }, options)) as any);
    await expect(service.createPost(org, body)).rejects.toThrow(`Injected ${stage} failure`);
    expect(await snapshot()).toEqual(before);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('finishes every shortlink preparation before any transaction or post mutation', async () => {
    body.shortLink = true;
    shortlinks.mockResolvedValueOnce(['Prepared root', 'Prepared child']).mockRejectedValueOnce(new Error('Preparation failed'));
    const transaction = jest.spyOn(db, '$transaction');
    await expect(service.createPost(org, body)).rejects.toThrow('Preparation failed');
    expect(transaction).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(['draft', 'schedule', 'now'])('commits all %s destinations, children, tags and replacements before dispatch', async (type) => {
    body.type = type;
    body.inter = 7;
    body.shortLink = true;
    shortlinks.mockImplementation(async (_org, content) => { expect(insideTransaction).toBe(false); return content; });
    const transaction = db.$transaction.bind(db);
    jest.spyOn(db, '$transaction').mockImplementation(((work: any, options: any) => transaction(async (tx) => {
      insideTransaction = true;
      expect(shortlinks).toHaveBeenCalledTimes(2);
      expect(dispatch).not.toHaveBeenCalled();
      try { return await work(tx); } finally { insideTransaction = false; }
    }, options)) as any);
    // Draft dispatch only terminates existing workflows, as before.
    if (type === 'draft') start.mockReset();
    const result = await service.createPost(org, body);
    expect(result).toHaveLength(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
    const active = await db.post.findMany({ where: { organizationId: org, deletedAt: null }, include: { tags: true } });
    expect(active).toHaveLength(4);
    expect(active.every((post) => post.state === (type === 'draft' ? 'DRAFT' : 'QUEUE') && post.intervalInDays === 7)).toBe(true);
    expect(active.filter((post) => !post.parentPostId).map((post) => post.tags.length)).toEqual([1, 1]);
    if (type === 'schedule') expect(active.every((post) => post.publishDate.toISOString() === body.date)).toBe(true);
    await Promise.all(dispatch.mock.results.map((result) => result.value));
    expect(dispatchObservations).toEqual(type === 'draft' ? [] : [{ inside: false, rows: 4 }, { inside: false, rows: 4 }]);
    expect(start).toHaveBeenCalledTimes(type === 'draft' ? 0 : 2);
  });

  it.each(['unavailable', 'lost acknowledgement'])('keeps committed schedules after dispatch %s and recovers the same roots without resaving', async (failure) => {
    const running = new Set<string>();
    start.mockImplementation(async (_name, options) => {
      if (failure === 'lost acknowledgement') running.add(options.workflowId);
      throw new Error('Temporal dispatch failed');
    });
    const result = await service.createPost(org, body);
    await Promise.all(dispatch.mock.results.map((result) => result.value));
    expect(start).toHaveBeenCalledTimes(2);
    const committed = await snapshot();
    const save = jest.spyOn(repository, 'createOrUpdatePost');
    const recovered = new Set<string>();
    const signalWithStart = jest.fn(async (_name, options) => {
      expect(options.workflowIdConflictPolicy).toBe('USE_EXISTING');
      if (options.args[0].organizationId === org) { recovered.add(options.workflowId); running.add(options.workflowId); }
    });
    const recoveryService = Object.assign(Object.create(PostsService.prototype), {
      _postRepository: repository, _submissions: { recoverPendingDispatches: async () => {} },
    });
    const recovery = Object.assign(Object.create(PostActivity.prototype), {
      _postService: recoveryService,
      _temporalService: { client: { getRawClient: () => ({ workflow: { signalWithStart } }) } },
    });
    await recovery.searchForMissingThreeHoursPosts();
    await recovery.searchForMissingThreeHoursPosts();
    expect(recovered).toEqual(new Set(result.map(({ postId }) => `post_${postId}`)));
    expect(running).toEqual(recovered);
    expect(save).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(committed);
  });
});
