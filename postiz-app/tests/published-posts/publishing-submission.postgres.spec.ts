import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common';
import { PostsRepository } from '../../libraries/nestjs-libraries/src/database/prisma/posts/posts.repository';
import { PublishingSubmissionService } from '../../libraries/nestjs-libraries/src/database/prisma/posts/publishing-submission.service';
import { CreatePostDto } from '../../libraries/nestjs-libraries/src/dtos/posts/create.post.dto';

// Never read DATABASE_URL or connect to a shared database. This suite only uses
// the disposable, explicitly provisioned local PostgreSQL test container.
const testUrl = process.env.EP_SUBMISSION_TEST_DATABASE_URL;
if (
  testUrl &&
  testUrl !== 'postgresql://isolated:isolated@127.0.0.1:55462/isolated'
) {
  throw new Error(
    'Submission tests require the isolated fixture URL on loopback port 55462.'
  );
}
const describePostgres = testUrl ? describe : describe.skip;
describePostgres('durable submissions against isolated PostgreSQL', () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          testUrl || 'postgresql://isolated:isolated@127.0.0.1:55462/isolated',
      },
    },
  });
  const model = { model: prisma };
  const repository = new PostsRepository(
    model as any,
    model as any,
    model as any,
    model as any,
    model as any,
    model as any
  );
  let service: PublishingSubmissionService;
  let org: string;
  let channels: string[];
  let request: CreatePostDto;
  let executions: Map<string, string>;
  let failStart: boolean;
  let loseAcknowledgement: boolean;
  let start: jest.Mock;
  const temporal = {
    client: {
      getRawClient: () => ({
        workflow: {
          start: (...args: any[]) => start(...args),
          getHandle: (id: string) => ({
            describe: async () => {
              if (!executions.has(id))
                throw new Error('Workflow not found or Temporal unavailable');
              return { status: { name: executions.get(id) } };
            },
          }),
        },
      }),
    },
  };
  const workflow = (postId: string, generation = 1) =>
    `post_${postId}_submission_${generation}`;
  const receipt = (id: string) => [
    {
      id,
      postId: `remote-${id}`,
      releaseURL: 'https://provider.example/post',
      status: 'success',
    },
  ];
  const runProvider = (
    postId: string,
    index: number,
    operation: jest.Mock,
    generation = 1
  ) =>
    service.runProvider(
      org,
      postId,
      channels[index],
      workflow(postId, generation),
      operation
    );

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    executions = new Map();
    failStart = false;
    loseAcknowledgement = false;
    start = jest.fn(async (_name: string, options: any) => {
      expect(options.workflowIdConflictPolicy).toBe('FAIL');
      expect(options.workflowIdReusePolicy).toBe('REJECT_DUPLICATE');
      expect(options.args[0].durableSubmission).toBe(true);
      if (failStart) throw new Error('Temporal unavailable');
      if (executions.has(options.workflowId))
        throw new WorkflowExecutionAlreadyStartedError(
          'Already started',
          options.workflowId,
          'postWorkflowV102'
        );
      executions.set(options.workflowId, 'RUNNING');
      if (loseAcknowledgement) throw new Error('Start acknowledgement lost');
    });
    service = new PublishingSubmissionService(
      prisma as any,
      repository,
      temporal as any
    );
    org = randomUUID();
    channels = [randomUUID(), randomUUID()].sort();
    await prisma.organization.create({
      data: { id: org, name: 'Isolated fixture' },
    });
    for (const [index, id] of channels.entries())
      await prisma.integration.create({
        data: {
          id,
          organizationId: org,
          internalId: id,
          name: `Fixture ${index}`,
          providerIdentifier: 'x',
          type: 'social',
          token: 'fixture-not-a-real-token',
        },
      });
    request = {
      type: 'now',
      submissionId: randomUUID(),
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: channels.map((id) => ({
        integration: { id },
        group: 'ignored-client-group',
        settings: { __type: 'x' },
        value: [
          {
            id: 'ignored-draft-id',
            content: 'Grounded caption',
            delay: 0,
            image: [],
          },
        ],
      })),
    } as CreatePostDto;
  });

  it('reconciles identical and concurrent requests to the same original roots', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.submit(org, request))
    );
    for (const result of results) expect(result).toEqual(results[0]);
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(2);
    expect(
      await prisma.publishingSubmission.count({
        where: { organizationId: org },
      })
    ).toBe(1);
    expect(executions.size).toBe(2);
    expect(
      await service.submit(org, { ...request, date: new Date().toISOString() })
    ).toEqual(results[0]);
  });

  it('rejects changed captions, settings, media and destinations without new posts', async () => {
    await service.submit(org, request);
    for (const changed of [
      {
        ...request,
        posts: [
          {
            ...request.posts[0],
            value: [{ ...request.posts[0].value[0], content: 'Different' }],
          },
          request.posts[1],
        ],
      },
      {
        ...request,
        posts: [
          {
            ...request.posts[0],
            settings: { __type: 'x', extra: 'different' },
          },
          request.posts[1],
        ],
      },
      {
        ...request,
        posts: [
          {
            ...request.posts[0],
            value: [
              {
                ...request.posts[0].value[0],
                image: [{ id: 'other', path: '/different.mp4' }],
              },
            ],
          },
          request.posts[1],
        ],
      },
      { ...request, posts: [request.posts[0]] },
    ])
      await expect(service.submit(org, changed as any)).rejects.toBeInstanceOf(
        ConflictException
      );
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(2);
  });

  it('serializes concurrent conflicting content and never publishes both', async () => {
    const changed = {
      ...request,
      posts: [
        {
          ...request.posts[0],
          value: [{ ...request.posts[0].value[0], content: 'Different' }],
        },
      ],
    };
    const results = await Promise.allSettled([
      service.submit(org, request),
      service.submit(org, changed as any),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected')
    ).toHaveLength(1);
    expect(
      await prisma.publishingSubmission.count({
        where: { organizationId: org },
      })
    ).toBe(1);
  });

  it('rolls back reservation, earlier destinations and post rows if sequential creation fails', async () => {
    const original = repository.createOrUpdatePost.bind(repository);
    const spy = jest
      .spyOn(repository, 'createOrUpdatePost')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(
        new Error('Server died during destination creation')
      );
    await expect(service.submit(org, request)).rejects.toThrow('Server died');
    spy.mockRestore();
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(0);
    expect(
      await prisma.publishingSubmission.count({
        where: { organizationId: org },
      })
    ).toBe(0);
    expect(start).not.toHaveBeenCalled();
    expect(await service.submit(org, request)).toHaveLength(2);
  });

  it('resumes only the missing destination after a partial Temporal dispatch', async () => {
    const original = start.getMockImplementation();
    start
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Second start unavailable'));
    const roots = await service.submit(org, request);
    expect(executions.size).toBe(1);
    await service.reconcile(org, request.submissionId, true);
    expect(executions.size).toBe(2);
    expect(await service.submit(org, request)).toEqual(roots);
  });

  it('recovers a lost database dispatch acknowledgement after Temporal already started', async () => {
    const spy = jest
      .spyOn(prisma.publishingSubmissionDestination, 'updateMany')
      .mockRejectedValueOnce(new Error('Dispatch receipt commit failed'));
    await expect(service.submit(org, request)).rejects.toThrow(
      'Dispatch receipt commit failed'
    );
    spy.mockRestore();
    expect(executions.size).toBe(1);
    await service.reconcile(org, request.submissionId, true);
    expect(executions.size).toBe(2);
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(2);
  });

  it('recovers a crash after reservation commit but before workflow dispatch', async () => {
    failStart = true;
    const posts = await service.submit(org, request);
    expect(
      (await service.reconcile(org, request.submissionId)).destinations.map(
        (d) => d.recoverability
      )
    ).toEqual(['resume-dispatch', 'resume-dispatch']);
    service = new PublishingSubmissionService(
      prisma as any,
      repository,
      temporal as any
    ); // reload/server restart
    failStart = false;
    await service.reconcile(org, request.submissionId, true);
    expect(await service.submit(org, request)).toEqual(posts);
    expect(executions.size).toBe(2);
  });

  it('recovers partial dispatch and lost start acknowledgements using stable workflow IDs', async () => {
    loseAcknowledgement = true;
    const posts = await service.submit(org, request);
    expect(executions.size).toBe(2);
    loseAcknowledgement = false;
    await service.recoverPendingDispatches();
    expect(executions.size).toBe(2);
    expect(
      (
        await prisma.publishingSubmissionDestination.findMany({
          where: { postId: { in: posts.map((p) => p.postId) } },
        })
      ).every((d) => d.dispatched)
    ).toBe(true);
  });

  it('reconciles a lost backend response after reload without reconstructing posts', async () => {
    const original = await service.submit(org, request); // response lost to the client
    service = new PublishingSubmissionService(
      prisma as any,
      repository,
      temporal as any
    );
    const recovered = await service.reconcile(org, request.submissionId);
    expect(new Set(recovered.destinations.map((d) => d.postId))).toEqual(
      new Set(original.map((p) => p.postId))
    );
    expect(await service.submit(org, request)).toEqual(original);
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(2);
  });

  it('fences concurrent provider calls and replays a persisted receipt after activity completion is lost', async () => {
    const posts = await service.submit(org, request);
    const id = posts[0].postId;
    let release: () => void;
    let started: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const publish = jest.fn(async () => {
      started();
      await blocked;
      return receipt(id);
    });
    const first = runProvider(id, 0, publish);
    await entered;
    await expect(runProvider(id, 0, publish)).rejects.toMatchObject({
      type: 'submission_uncertain',
      nonRetryable: true,
    });
    release();
    await first;
    service = new PublishingSubmissionService(
      prisma as any,
      repository,
      temporal as any
    );
    expect(await runProvider(id, 0, publish)).toEqual(receipt(id));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(
      (await service.reconcile(org, request.submissionId)).destinations[0].state
    ).toBe('published');
  });

  it('locks a crash after fence claim, provider rejection, timeout and failed receipt commit', async () => {
    const posts = await service.submit(org, request);
    const id = posts[0].postId;
    const publish = jest.fn(async () => {
      throw new Error('Provider may have accepted; response lost');
    });
    await expect(runProvider(id, 0, publish)).rejects.toMatchObject({
      type: 'submission_uncertain',
    });
    await expect(runProvider(id, 0, publish)).rejects.toMatchObject({
      type: 'submission_uncertain',
    });
    await expect(
      service.retryBeforeProvider(org, request.submissionId, channels[0])
    ).rejects.toBeInstanceOf(ConflictException);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(
      (await service.reconcile(org, request.submissionId)).destinations[0]
        .recoverability
    ).toBe('locked');
    const second = posts[1].postId;
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('Receipt commit lost'));
    const accepted = jest.fn(async () => receipt(second));
    await expect(runProvider(second, 1, accepted)).rejects.toMatchObject({
      type: 'submission_uncertain',
    });
    spy.mockRestore();
    await expect(runProvider(second, 1, accepted)).rejects.toMatchObject({
      type: 'submission_uncertain',
    });
    expect(accepted).toHaveBeenCalledTimes(1);
  });

  it('does not call an accepted, incomplete or fallback provider response published', async () => {
    const roots = await service.submit(org, request);
    const accepted = jest.fn(async () => [
      { ...receipt(roots[0].postId)[0], status: 'running' },
    ]);
    await expect(
      runProvider(roots[0].postId, 0, accepted)
    ).rejects.toMatchObject({ type: 'submission_uncertain' });
    await expect(
      runProvider(roots[0].postId, 0, accepted)
    ).rejects.toMatchObject({ type: 'submission_uncertain' });
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(
      (await service.reconcile(org, request.submissionId)).destinations[0].state
    ).toBe('uncertain');
    const missing = jest.fn(async () => [
      { ...receipt(roots[1].postId)[0], postId: 'missing' },
    ]);
    await expect(
      runProvider(roots[1].postId, 1, missing)
    ).rejects.toMatchObject({ type: 'submission_uncertain' });
    expect(
      (await prisma.post.findUnique({ where: { id: roots[1].postId } })).state
    ).toBe('QUEUE');
  });

  it('never recreates a published destination after partial success', async () => {
    const posts = await service.submit(org, request);
    await runProvider(
      posts[0].postId,
      0,
      jest.fn(async () => receipt(posts[0].postId))
    );
    const uncertain = jest.fn(async () => {
      throw new Error('Timed out');
    });
    await expect(runProvider(posts[1].postId, 1, uncertain)).rejects.toThrow();
    expect(await service.submit(org, request)).toEqual(posts);
    expect(
      (await service.reconcile(org, request.submissionId)).destinations.map(
        (d) => d.state
      )
    ).toEqual(['published', 'uncertain']);
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(2);
  });

  it('retries only a closed workflow that never crossed the provider fence, on the existing root', async () => {
    const posts = await service.submit(org, request);
    const id = posts[0].postId;
    await prisma.post.update({ where: { id }, data: { state: 'ERROR' } });
    await expect(
      service.retryBeforeProvider(org, request.submissionId, channels[0])
    ).rejects.toBeInstanceOf(ConflictException);
    executions.set(workflow(id), 'COMPLETED');
    await service.retryBeforeProvider(org, request.submissionId, channels[0]);
    expect(executions.has(workflow(id, 2))).toBe(true);
    const publish = jest.fn(async () => receipt(id));
    await expect(runProvider(id, 0, publish, 1)).rejects.toMatchObject({
      type: 'submission_mismatch',
    });
    await runProvider(id, 0, publish, 2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(2);
  });

  it('serializes concurrent confirmed-safe retries onto a single new workflow generation', async () => {
    const roots = await service.submit(org, request);
    const id = roots[0].postId;
    await prisma.post.update({ where: { id }, data: { state: 'ERROR' } });
    executions.set(workflow(id), 'COMPLETED');
    const results = await Promise.allSettled([
      service.retryBeforeProvider(org, request.submissionId, channels[0]),
      service.retryBeforeProvider(org, request.submissionId, channels[0]),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    expect(
      (
        await prisma.publishingSubmissionDestination.findUnique({
          where: { postId: id },
        })
      ).generation
    ).toBe(2);
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(2);
  });

  it('recovers a workflow crash before its first provider activity without creating a new post', async () => {
    const roots = await service.submit(org, request);
    const id = roots[0].postId;
    executions.set(workflow(id), 'FAILED');
    await service.retryBeforeProvider(org, request.submissionId, channels[0]);
    expect(executions.has(workflow(id, 2))).toBe(true);
    const publish = jest.fn(async () => receipt(id));
    await expect(runProvider(id, 0, publish, 1)).rejects.toMatchObject({
      type: 'submission_mismatch',
    });
    await runProvider(id, 0, publish, 2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(2);
  });

  it('does not overwrite a successful receipt when an ERROR update waits on its commit', async () => {
    const roots = await service.submit(org, request);
    const id = roots[0].postId;
    let committed: () => void;
    let allowCommit: () => void;
    const ready = new Promise<void>((resolve) => {
      committed = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      allowCommit = resolve;
    });
    const success = prisma.$transaction(async (tx) => {
      await tx.publishingSubmissionDestination.update({
        where: { postId: id },
        data: { providerState: 'SUCCEEDED', providerResult: receipt(id) },
      });
      await tx.post.update({
        where: { id },
        data: { state: 'PUBLISHED', releaseId: 'remote' },
      });
      committed();
      await gate;
    });
    await ready;
    const lateError = repository.changeState(
      id,
      'ERROR',
      'Late bookkeeping failure'
    );
    // Ensure the competing SQL reaches the held row lock before receipt commit.
    await new Promise((resolve) => setTimeout(resolve, 50));
    allowCommit();
    await Promise.all([success, lateError]);
    expect((await prisma.post.findUnique({ where: { id } })).state).toBe(
      'PUBLISHED'
    );
  });

  it('preserves successful receipts when later workflow bookkeeping fails', async () => {
    const posts = await service.submit(org, request);
    const id = posts[0].postId;
    await runProvider(
      id,
      0,
      jest.fn(async () => receipt(id))
    );
    await repository.changeState(id, 'ERROR', 'Notification failed');
    expect((await prisma.post.findUnique({ where: { id } })).state).toBe(
      'PUBLISHED'
    );
  });

  it('scopes attempt lookups, retry, creation and provider claims to the organization', async () => {
    const posts = await service.submit(org, request);
    const foreignOrg = randomUUID();
    await prisma.organization.create({
      data: { id: foreignOrg, name: 'Other fixture' },
    });
    await expect(
      service.reconcile(foreignOrg, request.submissionId)
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.retryBeforeProvider(foreignOrg, request.submissionId, channels[0])
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.submit(foreignOrg, request)).rejects.toThrow(
      'unavailable'
    );
    const publish = jest.fn(async () => receipt(posts[0].postId));
    await expect(
      service.runProvider(
        foreignOrg,
        posts[0].postId,
        channels[0],
        workflow(posts[0].postId),
        publish
      )
    ).rejects.toMatchObject({ type: 'submission_mismatch' });
    expect(publish).not.toHaveBeenCalled();
    expect(
      await prisma.post.count({ where: { organizationId: foreignOrg } })
    ).toBe(0);
  });

  it('leaves durable roots out of the legacy missing-post restarter', async () => {
    const roots = await service.submit(org, request);
    const { posts: normal } = await repository.createOrUpdatePost(
      'now',
      org,
      new Date().toISOString(),
      {
        ...request.posts[0],
        group: undefined,
        value: [{ ...request.posts[0].value[0], id: undefined }],
      },
      []
    );
    const missing = await repository.searchForMissingThreeHoursPosts();
    expect(
      missing.some((post) => roots.some((root) => root.postId === post.id))
    ).toBe(false);
    expect(missing.some((post) => post.id === normal[0].id)).toBe(true);
  });

  it('keeps the same attempt identifier independent across organizations with their own destinations', async () => {
    const other = randomUUID();
    await prisma.organization.create({
      data: { id: other, name: 'Other fixture' },
    });
    const channel = randomUUID();
    await prisma.integration.create({
      data: {
        id: channel,
        internalId: channel,
        organizationId: other,
        name: 'Other channel',
        providerIdentifier: 'x',
        type: 'social',
        token: 'fixture',
      },
    });
    const first = await service.submit(org, request);
    const second = await service.submit(other, {
      ...request,
      posts: [{ ...request.posts[0], integration: { id: channel } }],
    });
    expect(first[0].postId).not.toBe(second[0].postId);
    expect(
      (await service.reconcile(other, request.submissionId)).destinations
    ).toHaveLength(1);
  });

  it('rejects cross-organization media before any durable post or dispatch survives', async () => {
    const other = randomUUID();
    await prisma.organization.create({
      data: { id: other, name: 'Other fixture' },
    });
    const media = await prisma.media.create({
      data: {
        organizationId: other,
        name: 'fixture.mp4',
        path: '/fixture.mp4',
      },
    });
    request.posts[0].value[0].image = [{ id: media.id, path: media.path }];
    await expect(service.submit(org, request)).rejects.toThrow(
      'Source media is unavailable'
    );
    expect(await prisma.post.count({ where: { organizationId: org } })).toBe(0);
    expect(start).not.toHaveBeenCalled();
  });

  it('keeps an in-flight fence locked after server death even when Temporal retention has expired', async () => {
    const roots = await service.submit(org, request);
    await prisma.publishingSubmissionDestination.update({
      where: { postId: roots[0].postId },
      data: { dispatched: false, providerState: 'IN_FLIGHT' },
    });
    executions.clear();
    start.mockClear();
    await service.reconcile(org, request.submissionId, true);
    const publish = jest.fn(async () => receipt(roots[0].postId));
    await expect(
      runProvider(roots[0].postId, 0, publish)
    ).rejects.toMatchObject({ type: 'submission_uncertain' });
    expect(publish).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('fails closed when workflow closure cannot be verified before a safe retry', async () => {
    const roots = await service.submit(org, request);
    await prisma.post.update({
      where: { id: roots[0].postId },
      data: { state: 'ERROR' },
    });
    executions.clear();
    await expect(
      service.retryBeforeProvider(org, request.submissionId, channels[0])
    ).rejects.toThrow('closure cannot be verified');
    expect(
      (
        await prisma.publishingSubmissionDestination.findUnique({
          where: { postId: roots[0].postId },
        })
      ).generation
    ).toBe(1);
  });

  it('enforces database uniqueness and valid provider-fence states', async () => {
    const roots = await service.submit(org, request);
    const destination = await prisma.publishingSubmissionDestination.findUnique(
      { where: { postId: roots[0].postId } }
    );
    await expect(
      prisma.publishingSubmissionDestination.create({
        data: {
          submissionId: destination.submissionId,
          integrationId: channels[0],
          postId: roots[1].postId,
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.publishingSubmissionDestination.update({
        where: { id: destination.id },
        data: { providerState: 'INVALID' },
      })
    ).rejects.toThrow();
  });

  it('keeps normal provider calls outside the opt-in contract', async () => {
    const publish = jest.fn(async () => receipt('normal-post'));
    expect(
      await service.runProvider(
        org,
        'normal-post',
        channels[0],
        'normal-workflow',
        publish
      )
    ).toEqual(receipt('normal-post'));
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
