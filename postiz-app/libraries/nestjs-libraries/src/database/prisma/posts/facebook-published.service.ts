import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { FacebookProvider } from '../../../integrations/social/facebook.provider';
import { FacebookTextReceipt, PostResponse } from '../../../integrations/social/social.integrations.interface';

const unavailable = 'Only new, app-confirmed Facebook text/feed posts support these actions. Media, links, imported and legacy posts are read-only.';
const escaped = (message: string) => message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

@Injectable()
export class FacebookPublishedService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly provider = new FacebookProvider();

  private async target(orgId: string, postId: string) {
    const row = await this.prisma.publishingSubmissionDestination.findFirst({
      where: { postId, submission: { organizationId: orgId } },
      include: { post: { include: { integration: true, childrenPost: true } } },
    });
    if (!row) throw new NotFoundException(unavailable);
    const post = row.post;
    const integration = post.integration;
    const results = row.providerResult as unknown as PostResponse[];
    const receipt = Array.isArray(results) && results.length === 1 ? results[0] : undefined;
    const text = receipt?.facebookText;
    if (row.providerState !== 'SUCCEEDED' || post.organizationId !== orgId ||
        integration.organizationId !== orgId || integration.providerIdentifier !== 'facebook' ||
        row.integrationId !== post.integrationId || post.parentPostId || post.childrenPost.length ||
        post.deletedAt || !['PUBLISHED', 'DELETED_REMOTE'].includes(post.state) ||
        !text || text.version !== 1 || !process.env.FACEBOOK_APP_ID || text.appId !== process.env.FACEBOOK_APP_ID ||
        text.pageId !== integration.internalId || receipt.id !== post.id || receipt.postId !== post.releaseId ||
        !/^\d+_\d+$/.test(receipt.postId) || !receipt.postId.startsWith(`${text.pageId}_`) ||
        JSON.parse(post.image || '[]').length || JSON.parse(post.settings || '{}').url) {
      throw new BadRequestException(unavailable);
    }
    if (integration.disabled || integration.deletedAt || integration.inBetweenSteps || integration.refreshNeeded ||
        !integration.token || (integration.tokenExpiration && integration.tokenExpiration.getTime() <= Date.now()))
      throw new BadRequestException('Reconnect this Facebook Page before managing its posts.');
    return { row, post, integration, results, receipt, text };
  }

  private publicStatus(target: Awaited<ReturnType<FacebookPublishedService['target']>>) {
    const { post, integration, text, receipt } = target;
    return { eligible: true, postId: post.id, pageName: integration.name, releaseId: receipt.postId,
      permalink: `https://www.facebook.com/${receipt.postId}`, message: text.message,
      revision: text.revision, deleted: post.state === 'DELETED_REMOTE', pending: !!text.mutation,
      pendingAction: text.mutation?.action };
  }

  async status(orgId: string, postId: string) {
    try { return this.publicStatus(await this.target(orgId, postId)); }
    catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException)
        return { eligible: false, reason: error.message };
      throw error;
    }
  }

  private resultWith(target: Awaited<ReturnType<FacebookPublishedService['target']>>, text: FacebookTextReceipt) {
    return [{ ...target.receipt, facebookText: text }] as unknown as Prisma.InputJsonValue;
  }

  async mutate(orgId: string, postId: string, body: { action: 'edit' | 'delete'; revision: number; message?: string }) {
    if (!body || Object.keys(body).some((key) => !['action', 'revision', 'message'].includes(key)) ||
        !['edit', 'delete'].includes(body.action) || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
        (body.action === 'delete' && body.message !== undefined) ||
        (body.action === 'edit' && (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 63206 || /https?:\/\/|www\./i.test(body.message))))
      throw new BadRequestException('Supply only the action, current revision and plain text message (no links).');
    const target = await this.target(orgId, postId);
    if (target.text.mutation) throw new ConflictException('An operation needs reconciliation. Do not submit it again.');
    if (target.post.state === 'DELETED_REMOTE') {
      if (body.action === 'delete') return this.publicStatus(target);
      throw new ConflictException('This post was deleted on Facebook.');
    }
    if (target.text.revision !== body.revision) throw new ConflictException('This post changed. Reload before editing.');
    if (body.action === 'edit' && body.message === target.text.message) return this.publicStatus(target);
    const pending: FacebookTextReceipt = { ...target.text, mutation: {
      id: randomUUID(), action: body.action, ...(body.message === undefined ? {} : { message: body.message }), phase: 'IN_FLIGHT',
    } };
    const pendingResult = this.resultWith(target, pending);
    const claim = await this.prisma.publishingSubmissionDestination.updateMany({
      where: { id: target.row.id, providerState: 'SUCCEEDED', providerResult: { equals: target.row.providerResult },
        post: { id: postId, organizationId: orgId, integrationId: target.post.integrationId, group: target.post.group, releaseId: target.receipt.postId, state: 'PUBLISHED', deletedAt: null, integration: { disabled: false, deletedAt: null, inBetweenSteps: false, refreshNeeded: false } } },
      data: { providerResult: pendingResult },
    });
    if (claim.count !== 1) throw new ConflictException('Another operation changed this post. Reload before continuing.');
    try {
      const current = await this.provider.readPublishedText(target.text.pageId, target.integration.token, target.receipt.postId);
      if (current.message !== target.text.message) throw new Error('The Facebook message changed outside EverywherePoster.');
      if (body.action === 'edit') {
        await this.provider.update(target.text.pageId, target.integration.token, target.receipt.postId,
          [{ id: postId, message: body.message!, settings: {}, media: [] }]);
      } else {
        await this.provider.deletePublished(target.text.pageId, target.integration.token, target.receipt.postId);
      }
      // A durable success receipt lets reconciliation finish a failed local commit
      // without issuing another Graph mutation. Missing receipts remain locked.
      const confirmed = { ...pending, mutation: { ...pending.mutation!, phase: 'CONFIRMED' as const } };
      const saved = await this.prisma.publishingSubmissionDestination.updateMany({
        where: { id: target.row.id, providerResult: { equals: pendingResult } },
        data: { providerResult: this.resultWith(target, confirmed) },
      });
      if (saved.count !== 1) throw new Error('Mutation receipt changed.');
      return await this.reconcile(orgId, postId);
    } catch {
      await this.prisma.publishingSubmissionDestination.updateMany({
        where: { id: target.row.id, providerResult: { equals: pendingResult } },
        data: { providerResult: this.resultWith(target, { ...pending, mutation: { ...pending.mutation!, phase: 'UNCERTAIN' } }) },
      }).catch(() => undefined);
      throw new ConflictException('Facebook outcome needs reconciliation. Last confirmed content is preserved. Use Check result; do not resubmit.');
    }
  }

  async reconcile(orgId: string, postId: string) {
    const target = await this.target(orgId, postId);
    const mutation = target.text.mutation;
    if (!mutation) return this.publicStatus(target);
    if (mutation.phase === 'IN_FLIGHT') throw new ConflictException('An operation is still running or its worker stopped. No automatic retry or unlock is allowed. Check again after completion; contact support if it remains pending.');
    if (mutation.phase !== 'CONFIRMED') {
      if (mutation.action === 'delete') throw new ConflictException('Deletion is unconfirmed. Check Facebook and contact support; no automatic delete retry is allowed.');
      const remote = await this.provider.readPublishedText(target.text.pageId, target.integration.token, target.receipt.postId)
        .catch(() => { throw new ConflictException('Facebook cannot confirm this edit yet. The operation remains locked.'); });
      if (remote.message !== mutation.message) throw new ConflictException('The requested message is not confirmed. Check Facebook; the operation remains locked.');
    }
    const deleted = mutation.action === 'delete';
    const finished: FacebookTextReceipt = { ...target.text, message: deleted ? target.text.message : mutation.message!,
      revision: target.text.revision + 1, mutation: null };
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.publishingSubmissionDestination.updateMany({
        where: { id: target.row.id, providerResult: { equals: target.row.providerResult } },
        data: { providerResult: this.resultWith(target, finished) },
      });
      if (saved.count !== 1) throw new ConflictException('The result changed. Reload it.');
      const local = await tx.post.updateMany({ where: { id: postId, organizationId: orgId, integrationId: target.post.integrationId, group: target.post.group, releaseId: target.receipt.postId, state: 'PUBLISHED', deletedAt: null }, data: deleted
        ? { state: 'DELETED_REMOTE', remoteDeletedAt: new Date() }
        : { content: escaped(finished.message) } });
      if (local.count !== 1) throw new ConflictException('The original post identity changed. Reconciliation is required.');
      if (deleted) await tx.historicalPost.updateMany({
        where: { organizationId: orgId, platform: 'facebook', platformAccountId: target.text.pageId, platformPostId: target.receipt.postId },
        data: { deletedOrUnavailableAt: new Date() },
      });
    });
    return this.status(orgId, postId);
  }
}
