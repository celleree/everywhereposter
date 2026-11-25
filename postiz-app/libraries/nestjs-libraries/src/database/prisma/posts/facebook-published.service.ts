import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Post, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { FacebookProvider } from '../../../integrations/social/facebook.provider';
import {
  FacebookFeedReceipt,
  FacebookTextReceipt,
  PostResponse,
} from '../../../integrations/social/social.integrations.interface';

const unavailable =
  'EverywherePoster cannot verify this Facebook publication. To delete it, open the exact post on its Facebook Page and use the post menu.';

type ReceiptDetails = FacebookTextReceipt | FacebookFeedReceipt;
export type FacebookPublicationOutcome = {
  organizationId: string;
  integrationId: string;
  result: PostResponse;
};

function facebookReceipt(results: unknown) {
  const receipt =
    Array.isArray(results) && results.length === 1
      ? (results[0] as PostResponse | null)
      : null;
  const key = receipt?.facebookText === undefined ? 'facebookFeed' : 'facebookText';
  const text = receipt?.[key];
  if (
    !receipt ||
    receipt.status !== 'success' ||
    !text ||
    text.version !== (key === 'facebookText' ? 1 : 2) ||
    !process.env.FACEBOOK_APP_ID ||
    text.appId !== process.env.FACEBOOK_APP_ID ||
    typeof text.pageId !== 'string' ||
    typeof text.message !== 'string' ||
    !Number.isSafeInteger(text.revision) ||
    text.revision < 0 ||
    typeof receipt.postId !== 'string' ||
    !/^\d+_\d+$/.test(receipt.postId) ||
    !receipt.postId.startsWith(`${text.pageId}_`)
  ) return;
  const { mutation } = text;
  if (
    mutation !== null &&
    (!mutation ||
      typeof mutation.id !== 'string' ||
      !['edit', 'delete'].includes(mutation.action) ||
      !['IN_FLIGHT', 'UNCERTAIN', 'CONFIRMED'].includes(mutation.phase) ||
      (mutation.action === 'edit' && typeof mutation.message !== 'string'))
  ) return;
  return { receipt, key, text };
}

function isMessageOnly(post: Pick<Post, 'image' | 'settings'>) {
  try {
    const media = JSON.parse(post.image || '[]');
    const settings = JSON.parse(post.settings || '{}');
    return (
      Array.isArray(media) && !media.length &&
      !!settings && typeof settings === 'object' &&
      !Array.isArray(settings) && !settings.url
    );
  } catch {
    return false;
  }
}

const escaped = (message: string) =>
  message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

@Injectable()
export class FacebookPublishedService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly provider = new FacebookProvider();

  async recordLegacyPublication(
    postId: string,
    releaseId: string,
    releaseURL: string,
    { result, organizationId, integrationId }: FacebookPublicationOutcome
  ) {
    const publication = facebookReceipt([result]);
    if (
      !publication ||
      publication.text.revision !== 0 ||
      publication.text.mutation ||
      result.id !== postId ||
      result.postId !== releaseId ||
      !releaseURL ||
      releaseURL !== result.releaseURL
    ) return;

    const post: Prisma.PostWhereInput = {
      id: postId,
      organizationId,
      integrationId,
      integration: {
        organizationId,
        providerIdentifier: 'facebook',
        internalId: publication.text.pageId,
      },
      state: 'QUEUE',
      releaseId: null,
      deletedAt: null,
      parentPostId: null,
      childrenPost: { none: {} },
      submissionDestination: null,
    };
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.facebookPublicationReceipt.updateMany({
        where: {
          postId,
          organizationId,
          integrationId,
          providerResult: { equals: Prisma.DbNull },
          post,
        },
        data: { providerResult: [result] as unknown as Prisma.InputJsonValue },
      });
      if (!saved.count) return;
      const updated = await tx.post.updateMany({
        where: post,
        data: { state: 'PUBLISHED', releaseId, releaseURL, remoteDeletedAt: null },
      });
      if (!updated.count) throw new ConflictException('The Facebook publication identity changed.');
      return updated;
    });
  }

  private findPost(orgId: string, postId: string) {
    return this.prisma.post.findFirst({
      where: { id: postId, organizationId: orgId },
      include: {
        integration: true,
        childrenPost: { select: { id: true }, take: 1 },
        facebookPublicationReceipt: true,
        submissionDestination: {
          include: {
            submission: {
              select: {
                organizationId: true,
                _count: { select: { destinations: true } },
              },
            },
          },
        },
      },
    });
  }

  private async target(orgId: string, postId: string) {
    return this.verifiedTarget(orgId, await this.findPost(orgId, postId));
  }

  private verifiedTarget(
    orgId: string,
    post: Awaited<ReturnType<FacebookPublishedService['findPost']>>
  ) {
    if (!post) throw new NotFoundException(unavailable);
    const integration = post.integration;
    const durable = post.submissionDestination;
    const legacy = post.facebookPublicationReceipt;
    const row = durable ?? legacy;
    const publication = facebookReceipt(row?.providerResult);
    const ownedReceipt = durable
      ? durable.providerState === 'SUCCEEDED' && durable.submission.organizationId === orgId
      : legacy?.organizationId === orgId;
    if (
      !row ||
      !publication ||
      !ownedReceipt ||
      post.organizationId !== orgId ||
      integration.organizationId !== orgId ||
      integration.providerIdentifier !== 'facebook' ||
      integration.id !== post.integrationId ||
      row.integrationId !== post.integrationId ||
      post.parentPostId ||
      post.childrenPost.length ||
      post.deletedAt ||
      !['PUBLISHED', 'DELETED_REMOTE'].includes(post.state) ||
      publication.text.pageId !== integration.internalId ||
      publication.receipt.id !== post.id ||
      publication.receipt.postId !== post.releaseId ||
      !isMessageOnly(post)
    ) {
      throw new BadRequestException(unavailable);
    }
    if (
      integration.disabled ||
      integration.deletedAt ||
      integration.inBetweenSteps ||
      integration.refreshNeeded ||
      !integration.token ||
      (integration.tokenExpiration &&
        integration.tokenExpiration.getTime() <= Date.now())
    )
      throw new BadRequestException(
        'Reconnect this Facebook Page before managing its posts.'
      );
    const canEdit =
      publication.key === 'facebookText' && durable?.submission._count.destinations === 1;
    return { ...publication, row, durable, post, integration, canEdit };
  }

  private publicStatus(
    target: Awaited<ReturnType<FacebookPublishedService['target']>>
  ) {
    const { post, integration, text, receipt, canEdit } = target;
    return {
      eligible: true,
      canEdit,
      postId: post.id,
      pageName: integration.name,
      pageId: text.pageId,
      releaseId: receipt.postId,
      permalink: `https://www.facebook.com/${receipt.postId}`,
      message: text.message,
      revision: text.revision,
      deleted: post.state === 'DELETED_REMOTE',
      pending: !!text.mutation,
      pendingAction: text.mutation?.action,
    };
  }

  async status(orgId: string, postId: string) {
    const post = await this.findPost(orgId, postId);
    try {
      return this.publicStatus(this.verifiedTarget(orgId, post));
    } catch (error) {
      if (!(error instanceof BadRequestException || error instanceof NotFoundException)) throw error;
      const status = { eligible: false, reason: error.message };
      if (
        post && !post.deletedAt && post.state === 'PUBLISHED' &&
        post.organizationId === orgId && post.integration.organizationId === orgId &&
        post.integration.providerIdentifier === 'facebook' &&
        !post.facebookPublicationReceipt?.providerResult && !post.submissionDestination?.providerResult &&
        post.releaseId && /^\d+_\d+$/.test(post.releaseId) &&
        post.releaseId.startsWith(`${post.integration.internalId}_`)
      ) {
        return {
          ...status,
          pageName: post.integration.name,
          permalink: `https://www.facebook.com/${post.releaseId}`,
        };
      }
      return status;
    }
  }

  private resultWith(
    target: Awaited<ReturnType<FacebookPublishedService['target']>>,
    text: ReceiptDetails
  ) {
    return [
      { ...target.receipt, [target.key]: text },
    ] as unknown as Prisma.InputJsonValue;
  }

  private livePost(
    target: Awaited<ReturnType<FacebookPublishedService['target']>>
  ): Prisma.PostWhereInput {
    const { post, receipt, text } = target;
    return {
      id: post.id,
      organizationId: post.organizationId,
      integrationId: post.integrationId,
      group: post.group,
      releaseId: receipt.postId,
      state: 'PUBLISHED',
      deletedAt: null,
      parentPostId: null,
      childrenPost: { none: {} },
      image: post.image,
      settings: post.settings,
      integration: {
        organizationId: post.organizationId,
        providerIdentifier: 'facebook',
        internalId: text.pageId,
      },
    };
  }

  private writeReceipt(
    db: Pick<
      Prisma.TransactionClient,
      'publishingSubmissionDestination' | 'facebookPublicationReceipt'
    >,
    target: Awaited<ReturnType<FacebookPublishedService['target']>>,
    previous: Prisma.InputJsonValue,
    next: Prisma.InputJsonValue,
    post: Prisma.PostWhereInput = this.livePost(target)
  ) {
    const where = {
      postId: target.post.id,
      integrationId: target.post.integrationId,
      providerResult: { equals: previous },
      post,
    };
    const data = { providerResult: next };
    if (target.durable) {
      return db.publishingSubmissionDestination.updateMany({
        where: {
          ...where,
          id: target.durable.id,
          providerState: 'SUCCEEDED',
          submission: { organizationId: target.post.organizationId },
        },
        data,
      });
    }
    return db.facebookPublicationReceipt.updateMany({
      where: {
        ...where,
        organizationId: target.post.organizationId,
        post: { ...post, submissionDestination: null },
      },
      data,
    });
  }

  async mutate(
    orgId: string,
    postId: string,
    body: { action: 'edit' | 'delete'; revision: number; message?: string }
  ) {
    if (
      !body ||
      Object.keys(body).some(
        (key) => !['action', 'revision', 'message'].includes(key)
      ) ||
      !['edit', 'delete'].includes(body.action) ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 0 ||
      (body.action === 'delete' && body.message !== undefined) ||
      (body.action === 'edit' &&
        (typeof body.message !== 'string' ||
          !body.message.trim() ||
          body.message.length > 63206 ||
          /https?:\/\/|www\./i.test(body.message)))
    )
      throw new BadRequestException(
        'Supply only the action, current revision and plain text message (no links).'
      );
    const target = await this.target(orgId, postId);
    if (body.action === 'edit' && !target.canEdit)
      throw new BadRequestException('Editing is unavailable for this Facebook post.');
    if (target.text.mutation)
      throw new ConflictException(
        'An operation needs reconciliation. Do not submit it again.'
      );
    if (target.post.state === 'DELETED_REMOTE') {
      if (body.action === 'delete') return this.publicStatus(target);
      throw new ConflictException('This post was deleted on Facebook.');
    }
    if (target.text.revision !== body.revision)
      throw new ConflictException(
        body.action === 'edit'
          ? 'This post changed. Reload before editing.'
          : 'This post changed. Reload before deleting.'
      );
    if (body.action === 'edit' && body.message === target.text.message)
      return this.publicStatus(target);
    const pending: ReceiptDetails = {
      ...target.text,
      mutation: {
        id: randomUUID(),
        action: body.action,
        ...(body.message === undefined ? {} : { message: body.message }),
        phase: 'IN_FLIGHT',
      },
    };
    const previous = target.row.providerResult as Prisma.InputJsonValue;
    const pendingResult = this.resultWith(target, pending);
    const claim = await this.writeReceipt(this.prisma, target, previous, pendingResult, {
      ...this.livePost(target),
      AND: {
        integration: {
          disabled: false,
          deletedAt: null,
          inBetweenSteps: false,
          refreshNeeded: false,
          token: target.integration.token,
          OR: [{ tokenExpiration: null }, { tokenExpiration: { gt: new Date() } }],
        },
      },
    });
    if (claim.count !== 1)
      throw new ConflictException(
        'Another operation changed this post. Reload before continuing.'
      );
    try {
      const current = await this.provider.readPublishedText(
        target.text.pageId,
        target.integration.token,
        target.receipt.postId
      );
      if (current.message !== target.text.message)
        throw new Error(
          'The Facebook message changed outside EverywherePoster.'
        );
      if (body.action === 'edit') {
        await this.provider.update(
          target.text.pageId,
          target.integration.token,
          target.receipt.postId,
          [{ id: postId, message: body.message!, settings: {}, media: [] }]
        );
      } else {
        const result = await this.provider.deletePublished(
          target.text.pageId,
          target.integration.token,
          target.receipt.postId
        );
        if (result.status !== 'deleted') throw new Error('Facebook did not confirm deletion.');
      }
      // A durable success receipt lets reconciliation finish a failed local commit
      // without issuing another Graph mutation. Missing receipts remain locked.
      const confirmed = {
        ...pending,
        mutation: { ...pending.mutation!, phase: 'CONFIRMED' as const },
      };
      const saved = await this.writeReceipt(
        this.prisma, target, pendingResult, this.resultWith(target, confirmed)
      );
      if (saved.count !== 1) throw new Error('Mutation receipt changed.');
      return await this.reconcile(orgId, postId);
    } catch {
      await this.writeReceipt(
        this.prisma, target, pendingResult, this.resultWith(target, {
          ...pending,
          mutation: { ...pending.mutation!, phase: 'UNCERTAIN' },
        })
      ).catch(() => undefined);
      throw new ConflictException(
        'Facebook outcome needs reconciliation. Last confirmed content is preserved. Use Check result; do not resubmit.'
      );
    }
  }

  async reconcile(orgId: string, postId: string) {
    const target = await this.target(orgId, postId);
    const mutation = target.text.mutation;
    if (!mutation) return this.publicStatus(target);
    if (mutation.action === 'edit' && !target.canEdit)
      throw new BadRequestException('Editing is unavailable for this Facebook post.');
    if (mutation.phase === 'IN_FLIGHT')
      throw new ConflictException(
        'An operation is still running or its worker stopped. No automatic retry or unlock is allowed. Check again after completion; contact support if it remains pending.'
      );
    if (mutation.phase !== 'CONFIRMED') {
      if (mutation.action === 'delete')
        throw new ConflictException(
          'Deletion is unconfirmed. Check Facebook and contact support; no automatic delete retry is allowed.'
        );
      const remote = await this.provider
        .readPublishedText(
          target.text.pageId,
          target.integration.token,
          target.receipt.postId
        )
        .catch(() => {
          throw new ConflictException(
            'Facebook cannot confirm this edit yet. The operation remains locked.'
          );
        });
      if (remote.message !== mutation.message)
        throw new ConflictException(
          'The requested message is not confirmed. Check Facebook; the operation remains locked.'
        );
    }
    const deleted = mutation.action === 'delete';
    const finished: ReceiptDetails = {
      ...target.text,
      message: deleted ? target.text.message : mutation.message!,
      revision: target.text.revision + 1,
      mutation: null,
    };
    await this.prisma.$transaction(async (tx) => {
      const saved = await this.writeReceipt(
        tx, target, target.row.providerResult as Prisma.InputJsonValue, this.resultWith(target, finished)
      );
      if (saved.count !== 1)
        throw new ConflictException('The result changed. Reload it.');
      const local = await tx.post.updateMany({
        where: this.livePost(target),
        data: deleted
          ? { state: 'DELETED_REMOTE', remoteDeletedAt: new Date() }
          : { content: escaped(finished.message) },
      });
      if (local.count !== 1)
        throw new ConflictException(
          'The original post identity changed. Reconciliation is required.'
        );
      if (deleted)
        await tx.historicalPost.updateMany({
          where: {
            organizationId: orgId,
            platform: 'facebook',
            platformAccountId: target.text.pageId,
            platformPostId: target.receipt.postId,
          },
          data: { deletedOrUnavailableAt: new Date() },
        });
    });
    return this.status(orgId, postId);
  }
}
