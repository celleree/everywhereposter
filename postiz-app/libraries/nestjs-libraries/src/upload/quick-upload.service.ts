import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { QuickUploadIntent, Prisma } from '@prisma/client';
import { TemporalService } from 'nestjs-temporal-core';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common';
import { PrismaService } from '../database/prisma/prisma.service';
import { PostsService } from '../database/prisma/posts/posts.service';
import { MediaTranscriptionService } from '../database/prisma/media-transcription/media-transcription.service';
import { CopyGenerationService } from '../copy-generation/copy-generation.service';
import { GenerateMediaCopyResponse } from '../dtos/copy-generation/generate.media.copy.response';
import { QuickUploadIntentDto } from '../dtos/media/quick.upload.intent.dto';
import { ResumableUploadService } from './resumable-upload.service';
import { quickUploadAccountReason, quickUploadCopyReason } from '../copy-generation/quick-upload.rules';
import { mapIntegrationIdentifierToCopyPlatform, resolvePlatformRule } from '../copy-generation/platform-rules';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { IntegrationManager } from '../integrations/integration.manager';
import { CreatePostDto } from '../dtos/posts/create.post.dto';

type Destination = { id: string; name: string; identifier: string; settings: Record<string, any> };
type Result = { integrationId: string; name: string; state: string; reason?: string; postId?: string };
const terminal = ['COMPLETE', 'FAILED', 'CANCELLED'];
export const quickUploadWorkflowId = (id: string) => `quick-upload-${id}`;
export function quickUploadVideoReason(identifier: string, duration: number, settings: any, additional: any): string | null {
  const platform = mapIntegrationIdentifierToCopyPlatform(identifier);
  if (platform === 'x' && duration > 140 && !additional?.find((entry: any) => entry.title === 'Verified')?.value) return 'X requires a video up to 140 seconds on this account; use Customize.';
  if (platform === 'threads' && duration > 300) return 'Threads requires a video up to 300 seconds; use Customize.';
  if (platform === 'instagram' && duration > (settings.post_type === 'story' ? 60 : 180)) return 'Instagram video duration or post type needs Customize.';
  if (platform === 'instagram' && settings.is_trial_reel && settings.post_type !== 'reel') return 'Trial Reels require Reel settings; use Customize.';
  if (platform === 'linkedin' && settings.post_as_images_carousel) return 'A single video cannot be an image carousel; use Customize.';
  return null;
}

@Injectable()
export class QuickUploadService {
  constructor(private db: PrismaService, private uploads: ResumableUploadService,
    private transcriptions: MediaTranscriptionService, private copy: CopyGenerationService,
    private posts: PostsService, private permissions: PermissionsService, private temporal: TemporalService, private integrations: IntegrationManager) {}

  private enabled() {
    if (process.env.ENABLE_DURABLE_QUICK_UPLOAD !== 'true') throw new BadRequestException('Durable Quick Upload is not enabled. Use Customize.');
  }
  private async authorized(org: string, actor: string, role?: string) {
    const member = await this.db.userOrganization.findFirst({ where: { organizationId: org, userId: actor, disabled: false }, include: { user: true, organization: true } });
    if (!member?.user.activated || (role && member.role !== role)) throw new ConflictException('The consenting user no longer has the original organization permission.');
    const ability = await this.permissions.check(org, member.organization.createdAt, member.role,
      [[AuthorizationActions.Create, Sections.POSTS_PER_MONTH], [AuthorizationActions.Create, Sections.AI]]);
    if (!ability.can(AuthorizationActions.Create, Sections.POSTS_PER_MONTH) || !ability.can(AuthorizationActions.Create, Sections.AI)) throw new ConflictException('Publishing or caption-generation permission is unavailable.');
    return member;
  }
  private async own(org: string, sessionId: string) {
    const intent = await this.db.quickUploadIntent.findFirst({ where: { organizationId: org, sessionId } });
    if (!intent) throw new NotFoundException('Quick Upload intent not found.');
    return intent;
  }
  async enroll(org: string, actor: string, sessionId: string, body: QuickUploadIntentDto) {
    this.enabled();
    if (body.confirmNoIndividualReview !== true) throw new BadRequestException('Explicit consent without individual review is required.');
    const session = await this.uploads.get(org, sessionId);
    if (!['UPLOADING', 'FINALIZING', 'COMPLETE'].includes(session.status)) throw new ConflictException('This upload is no longer available.');
    const member = await this.authorized(org, actor);
    const previous = await this.db.quickUploadIntent.findUnique({ where: { sessionId } });
    if (previous) {
      const requested = body.destinations.map(value => ({ id: value.id, settings: value.settings }));
      const stored = (previous.destinations as unknown as Destination[]).map(value => ({ id: value.id, settings: value.settings }));
      if (previous.organizationId !== org || previous.actorId !== actor || JSON.stringify(requested) !== JSON.stringify(stored) || previous.status === 'CANCELLED') throw new ConflictException('Quick Upload consent is immutable.');
      await this.dispatch(previous); return this.status(org, sessionId);
    }
    const destinations: Destination[] = [];
    for (const requested of body.destinations) {
      const account = await this.db.integration.findFirst({ where: { id: requested.id, organizationId: org, deletedAt: null } });
      if (!account) throw new BadRequestException('A selected account is not available in this organization.');
      destinations.push({ id: account.id, name: account.name, identifier: account.providerIdentifier, settings: requested.settings });
    }
    // Unique session consent is the execution outbox. It exists before any dispatch.
    let intent: QuickUploadIntent;
    try { intent = await this.db.quickUploadIntent.create({ data: { sessionId, organizationId: org, actorId: actor, actorRole: member.role, destinations: destinations as any } }); }
    catch (error) { if ((error as any).code !== 'P2002') throw error; return this.enroll(org, actor, sessionId, body); }
    await this.dispatch(intent);
    return this.status(org, sessionId);
  }
  async cancel(org: string, actor: string, sessionId: string) {
    const intent = await this.own(org, sessionId);
    if (intent.actorId !== actor) throw new ConflictException('Only the consenting user can cancel this intent.');
    const changed = await this.db.quickUploadIntent.updateMany({ where: { id: intent.id, status: 'WAITING' }, data: { status: 'CANCELLED', message: 'Quick Upload cancelled before processing.' } });
    if (!changed.count && intent.status !== 'CANCELLED') throw new ConflictException('Quick Upload processing has started and cannot be cancelled here.');
    return this.status(org, sessionId);
  }
  async status(org: string, sessionId: string) {
    const row = await this.own(org, sessionId);
    return { id: row.id, status: row.status, results: row.results, message: row.message, consentVersion: row.consentVersion };
  }
  private async dispatch(intent: QuickUploadIntent) {
    if (intent.dispatched || terminal.includes(intent.status)) return;
    const client = this.temporal.client.getRawClient();
    if (!client) return;
    try {
      await client.workflow.start('quickUploadWorkflow', { workflowId: quickUploadWorkflowId(intent.id), taskQueue: 'main', workflowIdConflictPolicy: 'FAIL', workflowIdReusePolicy: 'REJECT_DUPLICATE', args: [{ intentId: intent.id }] });
    } catch (error) { if (!(error instanceof WorkflowExecutionAlreadyStartedError)) return; }
    await this.db.quickUploadIntent.update({ where: { id: intent.id }, data: { dispatched: true } });
  }
  async drain() {
    const pending = await this.db.quickUploadIntent.findMany({ where: { dispatched: false, status: 'WAITING' }, take: 50, orderBy: { createdAt: 'asc' } });
    for (const intent of pending) await this.dispatch(intent);
  }
  async fail(intentId: string) {
    const intent = await this.db.quickUploadIntent.findUnique({ where: { id: intentId } });
    if (!intent || terminal.includes(intent.status)) return;
    // Recover provider receipts through the existing ledger; never dispatch on this path.
    if (intent.submissionBody) {
      try { if (await this.reconcile(intentId)) return; } catch {}
    }
    const latest = await this.db.quickUploadIntent.findUnique({ where: { id: intentId } });
    const saved = latest!.results as unknown as Result[];
    const results = (intent.destinations as unknown as Destination[]).map(destination => {
      const receipt = saved.find(value => value.integrationId === destination.id);
      return receipt && ['Published', 'Skipped', 'Failed'].includes(receipt.state) ? receipt : {
        integrationId: destination.id, name: destination.name, state: 'Failed',
        reason: 'Outcome requires resolution. It will not be retried automatically.',
      };
    });
    await this.db.quickUploadIntent.updateMany({ where: { id: intentId, status: { notIn: terminal } }, data: { status: 'FAILED', results: results as any, message: 'Quick Upload stopped. An uncertain generation or publishing outcome needs resolution; it will not be retried automatically.' } });
  }

  private body(id: string, media: any, destinations: Destination[], captions: Map<string, string>): CreatePostDto {
    return { type: 'now', submissionId: `quick_${id}`, date: new Date().toISOString(), shortLink: false, tags: [], posts: destinations.map(destination => ({ integration: { id: destination.id }, settings: destination.settings as any, group: undefined, value: [{ content: captions.get(destination.id) || 'Quick Upload settings validation', image: [{ id: media.id, path: media.path }], delay: 0 }] })) };
  }
  private async candidates(intent: QuickUploadIntent, media: any, duration: number) {
    const accepted: Destination[] = [], skipped: Result[] = [];
    for (const destination of intent.destinations as unknown as Destination[]) {
      const account = await this.db.integration.findFirst({ where: { id: destination.id, organizationId: intent.organizationId, deletedAt: null } });
      let reason = !account ? 'Account is disconnected or unavailable.' :
        account.providerIdentifier !== destination.identifier ? 'The connected account changed; use Customize.' :
        quickUploadAccountReason({ ...account, identifier: account.providerIdentifier, ...(account.type === 'social' ? { publishedCapabilities: this.integrations.getSocialIntegration(account.providerIdentifier).getPublishedCapabilities(account) } : {}) });
      if (!reason && account) {
        let additional: any; try { additional = JSON.parse(account.additionalSettings || '[]'); } catch { additional = []; }
        reason = quickUploadVideoReason(destination.identifier, duration, destination.settings, additional);
      }
      if (!reason) {
        try { await this.posts.mapTypeToPost(this.body(intent.id, media, [destination], new Map()), intent.organizationId); }
        catch { reason = 'Required platform settings are missing or invalid; use Customize.'; }
      }
      if (reason) skipped.push({ integrationId: destination.id, name: destination.name, state: 'Skipped', reason }); else accepted.push(destination);
    }
    return { accepted, skipped };
  }

  async prepare(intentId: string): Promise<'WAIT' | 'READY' | 'DONE'> {
    const intent = await this.db.quickUploadIntent.findUnique({ where: { id: intentId }, include: { session: { include: { media: true, _count: { select: { parts: true } } } } } });
    if (!intent || terminal.includes(intent.status)) return 'DONE';
    if (intent.generated) return 'READY';
    if (intent.status === 'GENERATING') throw new ConflictException('Caption generation is uncertain and requires resolution.');
    await this.authorized(intent.organizationId, intent.actorId, intent.actorRole);
    if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(intent.session.status)) { await this.fail(intentId); return 'DONE'; }
    if (intent.session.status !== 'COMPLETE') {
      if (intent.session._count.parts !== intent.session.manifest.length) return 'WAIT';
      // The browser may disappear after the last part receipt, before POST complete.
      try { await this.uploads.complete(intent.organizationId, intent.sessionId); }
      catch (error) { if (error instanceof BadRequestException) throw error; return 'WAIT'; }
      return 'WAIT';
    }
    if (!intent.session.media || intent.session.media.deletedAt) throw new ConflictException('Source video is unavailable.');
    const ready = await this.db.quickUploadIntent.updateMany({ where: { id: intentId, status: 'WAITING' }, data: { status: 'PROCESSING' } });
    if (!ready.count && intent.status !== 'PROCESSING') return 'DONE';
    const selection = await this.candidates(intent, intent.session.media, intent.session.duration!);
    if (!selection.accepted.length) {
      await this.db.quickUploadIntent.update({ where: { id: intentId }, data: { status: 'COMPLETE', results: selection.skipped as any, message: 'All destinations were skipped; use Customize.' } }); return 'DONE';
    }
    const transcription = await this.transcriptions.ensureTranscriptionStarted(intent.organizationId, intent.session.mediaId!, true);
    if (transcription.status === 'FAILED') throw new ConflictException('Transcription failed; individual review is required.');
    return transcription.status === 'READY' ? 'READY' : 'WAIT';
  }

  async generate(intentId: string) {
    const intent = await this.db.quickUploadIntent.findUnique({ where: { id: intentId }, include: { session: { include: { media: true } } } });
    if (intent?.generated) return;
    if (!intent || intent.session.status !== 'COMPLETE' || !intent.session.media || intent.session.media.deletedAt) throw new ConflictException('Completed source media is required.');
    await this.authorized(intent.organizationId, intent.actorId, intent.actorRole);
    const claimed = await this.db.quickUploadIntent.updateMany({ where: { id: intentId, status: 'PROCESSING', copyStartedAt: null }, data: { status: 'GENERATING', copyStartedAt: new Date() } });
    if (!claimed.count) throw new ConflictException('Generation is already claimed or uncertain. It will not be repeated automatically.');
    const { accepted, skipped } = await this.candidates(intent, intent.session.media, intent.session.duration!);
    const platforms = [...new Set(accepted.map(value => mapIntegrationIdentifierToCopyPlatform(value.identifier)!))];
    if (!platforms.length) { await this.db.quickUploadIntent.update({ where: { id: intentId }, data: { status: 'COMPLETE', results: skipped as any } }); return; }
    let result: GenerateMediaCopyResponse | undefined;
    for await (const event of this.copy.generate(intent.organizationId, { mediaId: intent.session.mediaId!, platforms, captionMode: 'generate', goal: 'attract' })) {
      if (event.name === 'completed') result = event.data as GenerateMediaCopyResponse;
    }
    if (!result) throw new ConflictException('Caption generation outcome is uncertain.');
    await this.db.quickUploadIntent.updateMany({ where: { id: intentId, status: 'GENERATING' }, data: { generated: result as any, status: 'GENERATED' } });
  }

  async submit(intentId: string) {
    const intent = await this.db.quickUploadIntent.findUnique({ where: { id: intentId }, include: { session: { include: { media: true } } } });
    if (!intent || terminal.includes(intent.status)) return;
    await this.authorized(intent.organizationId, intent.actorId, intent.actorRole);
    if (intent.session.status !== 'COMPLETE' || !intent.session.media || intent.session.media.deletedAt) throw new ConflictException('Completed source media is required.');
    let payload = intent.submissionBody as unknown as CreatePostDto;
    if (!payload) {
      const selection = await this.candidates(intent, intent.session.media, intent.session.duration!);
      const response = intent.generated as unknown as GenerateMediaCopyResponse;
      const captions = new Map<string, string>(), accepted: Destination[] = [], results = [...selection.skipped];
      for (const destination of selection.accepted) {
        const platform = mapIntegrationIdentifierToCopyPlatform(destination.identifier)!;
        const copy = response?.results.find(value => value.platform === platform);
        const reason = quickUploadCopyReason(response, copy) || (copy!.draft.length > resolvePlatformRule(platform).hardCap ? 'Caption exceeds the platform limit; use Customize.' : null);
        if (reason) results.push({ integrationId: destination.id, name: destination.name, state: 'Skipped', reason });
        else { accepted.push(destination); captions.set(destination.id, copy!.draft); }
      }
      if (!accepted.length) { await this.db.quickUploadIntent.update({ where: { id: intentId }, data: { status: 'COMPLETE', results: results as any } }); return; }
      payload = await this.posts.mapTypeToPost(this.body(intentId, intent.session.media, accepted, captions), intent.organizationId);
      const saved = await this.db.quickUploadIntent.updateMany({ where: { id: intentId, status: 'GENERATED', submissionBody: { equals: Prisma.DbNull } }, data: { submissionBody: payload as any, status: 'PUBLISHING', results: results as any } });
      if (!saved.count) { const latest = await this.db.quickUploadIntent.findUnique({ where: { id: intentId } }); payload = latest?.submissionBody as unknown as CreatePostDto; }
    }
    if (!payload) return;
    // Only #164 creates posts/dispatches providers. No Quick Upload provider retries exist here.
    await this.posts.createPost(intent.organizationId, payload);
    await this.reconcile(intentId);
  }
  async reconcile(intentId: string): Promise<boolean> {
    const intent = await this.db.quickUploadIntent.findUnique({ where: { id: intentId } });
    if (!intent || terminal.includes(intent.status)) return true;
    const ledger = await this.posts.reconcileSubmission(intent.organizationId, `quick_${intentId}`);
    const names = new Map((intent.destinations as unknown as Destination[]).map(value => [value.id, value.name]));
    const results = (intent.results as unknown as Result[]).filter(value => value.state === 'Skipped');
    for (const destination of ledger.destinations) results.push({ integrationId: destination.integrationId, name: names.get(destination.integrationId) || destination.integrationId, postId: destination.postId,
      state: destination.state === 'published' ? 'Published' : ['uncertain', 'failed', 'failed-before-provider', 'unavailable', 'reconnect-required'].includes(destination.state) ? 'Failed' : 'Publishing',
      ...(destination.state === 'uncertain' ? { reason: 'Publishing outcome is uncertain. It will not be retried automatically.' } : {}) });
    const done = !results.some(value => value.state === 'Publishing');
    await this.db.quickUploadIntent.update({ where: { id: intentId }, data: { results: results as any, status: done ? 'COMPLETE' : 'PUBLISHING' } });
    return done;
  }
}
