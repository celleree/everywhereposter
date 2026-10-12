import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ApplicationFailure,
  WorkflowExecutionAlreadyStartedError,
  TypedSearchAttributes,
} from '@temporalio/common';
import { TemporalService } from 'nestjs-temporal-core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PostsRepository } from './posts.repository';
import { CreatePostDto } from '../../../dtos/posts/create.post.dto';
import { PostResponse } from '../../../integrations/social/social.integrations.interface';
import { publishingAttemptContext } from '../../../integrations/publishing-attempt.context';
import {
  organizationId as organizationAttribute,
  postId as postAttribute,
} from '../../../temporal/temporal.search.attribute';
const CLOSED_WORKFLOW_STATES = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
];

// Property order and client draft IDs are not publication content. Immediate
// publication uses the reservation time, not a new client clock on each replay.
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.keys(value)
          .filter((key) => value[key] !== undefined)
          .sort()
          .map((key) => [key, canonical(value[key])])
      )
    : value;
export const submissionContent = (body: CreatePostDto) => ({
  type: body.type,
  shortLink: body.shortLink,
  inter: body.inter,
  tags: [...body.tags].sort((a, b) =>
    a.value < b.value ? -1 : a.value > b.value ? 1 : 0
  ),
  posts: body.posts
    .map((post) => ({
      integration: post.integration,
      settings: post.settings,
      value: post.value.map(({ id, ...value }) => value),
    }))
    .sort((a, b) =>
      a.integration.id < b.integration.id
        ? -1
        : a.integration.id > b.integration.id
        ? 1
        : 0
    ),
});
export const submissionHash = (body: CreatePostDto) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(submissionContent(body))))
    .digest('hex');
const workflowId = (destination: { postId: string; generation: number }) =>
  `post_${destination.postId}_submission_${destination.generation}`;
const includesDestinations = {
  destinations: {
    orderBy: { integrationId: 'asc' },
    include: { post: { include: { integration: true } } },
  },
} as const;

@Injectable()
export class PublishingSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posts: PostsRepository,
    private readonly temporal: TemporalService
  ) {}

  async submit(organizationId: string, body: CreatePostDto) {
    if (
      !/^[a-zA-Z0-9_-]{16,128}$/.test(body.submissionId || '') ||
      body.type !== 'now' ||
      body.shortLink ||
      body.inter ||
      !body.posts.length ||
      body.posts.length > 100 ||
      body.posts.some(
        (post) =>
          post.value.length !== 1 ||
          Object.keys(post.settings || {}).some((key) =>
            key.startsWith('plug-')
          )
      ) ||
      new Set(body.posts.map((post) => post.integration.id)).size !==
        body.posts.length
    ) {
      throw new BadRequestException(
        'Durable submissions require new immediate posts, one root per destination, no repeating, plugs or shortlinks.'
      );
    }
    const contentHash = submissionHash(body);
    let attempt;
    try {
      attempt = await this.prisma.$transaction(
        async (tx) => {
          // Unique reservation is acquired before post creation. A competing request
          // waits on the unique index; any failed transaction rolls back all roots.
          const reserved = await tx.publishingSubmission.create({
            data: {
              organizationId,
              attemptId: body.submissionId,
              contentHash,
            },
          });
          for (const requested of body.posts) {
            const integration = await tx.integration.findFirst({
              where: {
                id: requested.integration.id,
                organizationId,
                deletedAt: null,
                disabled: false,
                refreshNeeded: false,
                inBetweenSteps: false,
              },
            });
            if (!integration)
              throw new BadRequestException(
                'A destination is unavailable or requires reconnection.'
              );
            const images = requested.value[0].image;
            const media = await tx.media.findMany({
              where: {
                id: { in: images.map((image) => image.id) },
                organizationId,
                deletedAt: null,
              },
              select: { id: true, path: true },
            });
            if (
              images.some(
                (image) =>
                  !media.some(
                    (owned) =>
                      owned.id === image.id && owned.path === image.path
                  )
              )
            ) {
              throw new BadRequestException(
                'Source media is unavailable in this organization.'
              );
            }
            const { posts } = await this.posts.createOrUpdatePost(
              'now',
              organizationId,
              reserved.createdAt.toISOString(),
              {
                ...requested,
                group: undefined,
                value: requested.value.map(({ id, ...value }) => value),
              },
              body.tags,
              undefined,
              tx
            );
            await tx.publishingSubmissionDestination.create({
              data: {
                submissionId: reserved.id,
                integrationId: integration.id,
                postId: posts[0].id,
              },
            });
          }
          return tx.publishingSubmission.findUnique({
            where: { id: reserved.id },
            include: includesDestinations,
          });
        },
        { timeout: 15000 }
      );
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      attempt = await this.load(organizationId, body.submissionId);
      if (attempt.contentHash !== contentHash)
        throw new ConflictException(
          'This submission ID already belongs to different content.'
        );
    }
    // Temporal is outside the transaction. Pending rows form the durable outbox.
    await this.dispatch(attempt.destinations);
    return attempt.destinations.map(({ postId, integrationId }) => ({
      postId,
      integration: integrationId,
    }));
  }

  private async load(organizationId: string, attemptId: string) {
    const attempt = await this.prisma.publishingSubmission.findUnique({
      where: {
        organizationId_attemptId: { organizationId, attemptId },
      },
      include: includesDestinations,
    });
    if (!attempt) throw new NotFoundException('Submission not found.');
    return attempt;
  }

  private async dispatch(
    destinations: Awaited<
      ReturnType<PublishingSubmissionService['load']>
    >['destinations']
  ) {
    for (const destination of destinations) {
      if (
        destination.dispatched ||
        destination.providerState !== 'READY' ||
        destination.post.state !== 'QUEUE' ||
        destination.post.deletedAt
      )
        continue;
      try {
        const client = this.temporal.client.getRawClient();
        if (!client) continue;
        await client.workflow.start('postWorkflowV102', {
          workflowId: workflowId(destination),
          taskQueue: 'main',
          workflowIdConflictPolicy: 'FAIL',
          workflowIdReusePolicy: 'REJECT_DUPLICATE',
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: organizationAttribute,
              value: destination.post.organizationId,
            },
            { key: postAttribute, value: destination.postId },
          ]),
          args: [
            {
              taskQueue: destination.post.integration.providerIdentifier
                .split('-')[0]
                .toLowerCase(),
              postId: destination.postId,
              organizationId: destination.post.organizationId,
              durableSubmission: true,
            },
          ],
        });
      } catch (error) {
        // Lost start acknowledgements are replayed with the same Workflow ID,
        // never terminated/restarted. The DB fence survives Temporal retention.
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) continue;
      }
      await this.prisma.publishingSubmissionDestination.updateMany({
        where: {
          id: destination.id,
          generation: destination.generation,
        },
        data: { dispatched: true },
      });
    }
  }

  async recoverPendingDispatches() {
    const destinations =
      await this.prisma.publishingSubmissionDestination.findMany({
        where: {
          dispatched: false,
          providerState: 'READY',
          post: { state: 'QUEUE', deletedAt: null },
        },
        include: { post: { include: { integration: true } } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
    await this.dispatch(destinations);
  }

  private async workflowState(destination: {
    postId: string;
    generation: number;
  }) {
    try {
      const client = this.temporal.client.getRawClient();
      const description = await client.workflow
        .getHandle(workflowId(destination))
        .describe();
      return description.status.name as string;
    } catch {
      return 'unknown'; // Unavailability or expired history is not closure proof.
    }
  }

  async reconcile(organizationId: string, attemptId: string, resume = false) {
    let attempt = await this.load(organizationId, attemptId);
    if (resume) {
      await this.dispatch(attempt.destinations);
      attempt = await this.load(organizationId, attemptId);
    }
    const destinations = await Promise.all(
      attempt.destinations.map(async (destination) => {
        const post = destination.post;
        const reconnect =
          post.integration.refreshNeeded || post.integration.inBetweenSteps;
        const uncertain = ['IN_FLIGHT', 'UNCERTAIN'].includes(
          destination.providerState
        );
        const published =
          destination.providerState === 'SUCCEEDED' &&
          post.state === 'PUBLISHED';
        const execution =
          destination.providerState === 'READY' && destination.dispatched
            ? await this.workflowState(destination)
            : 'unknown';
        const safeFailure =
          destination.providerState === 'READY' &&
          CLOSED_WORKFLOW_STATES.includes(execution) &&
          ['ERROR', 'QUEUE'].includes(post.state) &&
          !post.releaseId;
        const unavailable = post.deletedAt || post.state === 'DELETED_REMOTE';
        return {
          integrationId: destination.integrationId,
          postId: destination.postId,
          generation: destination.generation,
          postState: post.state,
          providerState: destination.providerState,
          workflowState: execution,
          state: unavailable
            ? 'unavailable'
            : uncertain
            ? 'uncertain'
            : published
            ? 'published'
            : reconnect
            ? 'reconnect-required'
            : safeFailure
            ? 'failed-before-provider'
            : post.state === 'ERROR'
            ? 'failed'
            : 'processing',
          recoverability:
            unavailable || uncertain
              ? 'locked'
              : published
              ? 'complete'
              : safeFailure
              ? 'retry-before-provider'
              : !destination.dispatched && post.state === 'QUEUE'
              ? 'resume-dispatch'
              : 'locked',
        };
      })
    );
    return { submissionId: attempt.attemptId, destinations };
  }

  async retryBeforeProvider(
    organizationId: string,
    attemptId: string,
    integrationId: string
  ) {
    const attempt = await this.load(organizationId, attemptId);
    const destination = attempt.destinations.find(
      (item) => item.integrationId === integrationId
    );
    if (
      !destination ||
      destination.providerState !== 'READY' ||
      !['ERROR', 'QUEUE'].includes(destination.post.state) ||
      destination.post.releaseId ||
      destination.post.deletedAt
    ) {
      throw new ConflictException('This destination cannot be safely retried.');
    }
    // Closed workflow plus an unconsumed provider fence proves no publish call
    // started. Temporal unavailability is not proof and must fail closed.
    if (
      !CLOSED_WORKFLOW_STATES.includes(await this.workflowState(destination))
    ) {
      throw new ConflictException(
        'The original workflow is active or closure cannot be verified.'
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.publishingSubmissionDestination.updateMany({
        where: {
          id: destination.id,
          generation: destination.generation,
          providerState: 'READY',
          post: {
            state: { in: ['ERROR', 'QUEUE'] },
            releaseId: null,
            deletedAt: null,
          },
        },
        data: { generation: { increment: 1 }, dispatched: false },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'The destination changed; reconcile before retrying.'
        );
      await tx.post.update({
        where: { id: destination.postId },
        data: { state: 'QUEUE', error: null },
      });
    });
    return this.reconcile(organizationId, attemptId, true);
  }

  async runProvider(
    organizationId: string,
    postId: string,
    integrationId: string,
    executingWorkflowId: string,
    operation: () => Promise<PostResponse[]>
  ) {
    const destination =
      await this.prisma.publishingSubmissionDestination.findUnique({
        where: { postId },
        include: { submission: true },
      });
    if (!destination) return operation(); // Existing normal publishing behavior.
    if (
      destination.submission.organizationId !== organizationId ||
      destination.integrationId !== integrationId ||
      workflowId(destination) !== executingWorkflowId
    ) {
      throw ApplicationFailure.nonRetryable(
        'Submission workflow or organization mismatch.',
        'submission_mismatch'
      );
    }
    if (destination.providerState === 'SUCCEEDED')
      return destination.providerResult as unknown as PostResponse[];
    const claimed =
      await this.prisma.publishingSubmissionDestination.updateMany({
        where: {
          id: destination.id,
          generation: destination.generation,
          providerState: 'READY',
          post: {
            organizationId,
            integrationId,
            state: 'QUEUE',
            deletedAt: null,
            releaseId: null,
            integration: {
              organizationId,
              disabled: false,
              refreshNeeded: false,
              inBetweenSteps: false,
              deletedAt: null,
            },
          },
        },
        data: { providerState: 'IN_FLIGHT' },
      });
    if (claimed.count !== 1) {
      throw ApplicationFailure.nonRetryable(
        'The provider may have accepted this post. Reconcile; do not resend.',
        'submission_uncertain'
      );
    }
    try {
      const result = await publishingAttemptContext.run(true, operation);
      if (
        !Array.isArray(result) ||
        result.length !== 1 ||
        result[0].id !== postId ||
        typeof result[0].postId !== 'string' ||
        !result[0].postId.trim() ||
        !['success', 'posted', 'completed', 'published'].includes(
          result[0].status
        ) ||
        result[0].postId === 'missing' ||
        typeof result[0].releaseURL !== 'string' ||
        !result[0].releaseURL.trim()
      ) {
        throw new Error(
          'The provider did not return a confirmed publication result.'
        );
      }
      // Persist the receipt and post outcome together before activity completion.
      await this.prisma.$transaction(async (tx) => {
        await tx.publishingSubmissionDestination.update({
          where: { id: destination.id },
          data: {
            providerState: 'SUCCEEDED',
            providerResult: result as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.post.update({
          where: { id: postId },
          data: {
            state: 'PUBLISHED',
            releaseId: result[0].postId,
            releaseURL: result[0].releaseURL,
            error: null,
          },
        });
      });
      return result;
    } catch {
      // No expiry/lease reset: worker death, provider rejection, timeout, and a
      // failed receipt commit all require reconciliation, never a fresh call.
      await this.prisma.publishingSubmissionDestination
        .updateMany({
          where: {
            id: destination.id,
            providerState: 'IN_FLIGHT',
          },
          data: { providerState: 'UNCERTAIN' },
        })
        .catch(() => undefined);
      throw ApplicationFailure.nonRetryable(
        'The provider outcome is uncertain. Check the connected account; do not resend.',
        'submission_uncertain'
      );
    }
  }
}
