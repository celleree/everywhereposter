import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { join } from 'path';
import { createReadStream } from 'fs';
import { mkdir, rmdir, writeFile } from 'fs/promises';
import { PrismaService } from '../database/prisma/prisma.service';
import { UploadFactory } from '../upload/upload.factory';
import { StudioEditRepository, StudioEditRequest, normalizeStudioRequest } from './studio-edit.repository';
import { studioFingerprint } from './studio-receipt';
import { StudioApprovedPlan, inspectStudioExport, runStudioProject, stageStudioPlan, studioDirectory, studioHashFile, studioJson, studioRuntime } from './studio-worker';
import { CookedReviewService } from './cooked-review.service';
import { StudioDirectorService } from './studio-director.service';
import { validateStudioEvidence } from './studio-evidence';

// Authored plans enter through the internal worker method, never HTTP paths or
// uncharged model inference. Technical readiness does not authorize publishing.
@Injectable()
export class StudioEditService {
  private readonly storage = UploadFactory.createStorage();
  private readonly running = new Map<string, Promise<void>>();
  constructor(private readonly jobs: StudioEditRepository, private readonly db: PrismaService,
    private readonly cooked?: CookedReviewService, private readonly director?: StudioDirectorService) {}
  admit(org: string, body: StudioEditRequest) { return this.jobs.admit(org, body); }
  async availability(org: string) {
    try { await studioRuntime(org); return { enabled: true, scope: 'stationary-single-speaker-portrait-cfr30-v1' }; }
    catch { return { enabled: false }; }
  }
  async create(org: string, body: StudioEditRequest) {
    await studioRuntime(org);
    const request = normalizeStudioRequest(body);
    if (!request.creative || !this.cooked || !this.director) throw new BadRequestException('Studio requires a brief and confirmed stationary speaker framing');
    let row = await this.jobs.admit(org, request); await this.assertOwned(org, row);
    if (row.state === 'ADMITTED') {
      row = await this.jobs.claim(org, row.id, row.generation);
      this.startProducer(org, row);
    }
    // Repeated creation never launches another pipeline for a RUNNING row.
    return { id: row.id, generation: row.generation, state: row.state };
  }
  async resume(org: string, job: string) {
    const row = await this.jobs.get(org, job); await this.assertOwned(org, row); const config = await studioRuntime(org);
    if (row.state !== 'RUNNING' || !(row.input as any).request.creative) throw new ConflictException('This Studio edit cannot be resumed');
    if (!this.running.has(org + ':' + row.id)) {
      const dir = studioDirectory(config, row); await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(join(dir, 'producer-status.json'), JSON.stringify({ phase: 'RUNNING' }));
    }
    this.startProducer(org, row); return { id: row.id, generation: row.generation, state: row.state };
  }
  private startProducer(org: string, row: any) {
    const key = org + ':' + row.id;
    if (this.running.has(key)) return;
    const operation = this.produce(org, row).catch(async error => {
      // No raw provider/native errors, transcripts or paths in the public ledger.
      try { const c = await studioRuntime(org); await writeFile(join(studioDirectory(c, row), 'producer-status.json'), JSON.stringify({ phase: error?.studioNotAdmitted === true ? 'WAITING_FOR_WORKER' : 'NEEDS_VERIFICATION' })); } catch {}
    }).finally(() => this.running.delete(key));
    this.running.set(key, operation);
  }
  private async produce(org: string, row: any) {
    if (!this.cooked || !this.director) throw new ServiceUnavailableException('Studio producer is unavailable');
    const config = await studioRuntime(org), dir = studioDirectory(config, row);
    await mkdir(dir, { recursive: true, mode: 0o700 }); await this.assertOwned(org, row);
    let raw: any;
    try { raw = await studioJson(join(dir, 'evidence.json')); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      let allowCreate = false;
      const marker = join(dir, 'native-dispatch.json'), guard = join(dir, 'native-admission.lock');
      // Atomic, short filesystem admission transition shared across processes.
      // A retained PENDING marker can only find/recover the same native job.
      await mkdir(guard);
      try {
        let prior: any;
        try { prior = await studioJson(marker); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (prior && (prior.requestId !== row.id || prior.inputFingerprint !== row.inputFingerprint)) throw new ConflictException('Native admission identity changed');
        allowCreate = !prior || prior.state === 'NOT_ADMITTED';
        if (allowCreate) await writeFile(marker, JSON.stringify({ requestId: row.id, inputFingerprint: row.inputFingerprint, state: 'PENDING' }), { mode: 0o600 });
      } finally { await rmdir(guard); }
      try { raw = await this.cooked.studioSource(org, row.sourceMediaId, row.id, dir, allowCreate); }
      catch (error) {
        if (allowCreate && (error as { studioNotAdmitted?: boolean }).studioNotAdmitted === true) {
          await writeFile(marker, JSON.stringify({ requestId: row.id, inputFingerprint: row.inputFingerprint, state: 'NOT_ADMITTED' }));
        }
        throw error;
      }
    }
    const evidence = validateStudioEvidence(raw, { organizationId: org, mediaId: row.sourceMediaId });
    const current = await this.jobs.get(org, row.id);
    if (current.generation !== row.generation || current.leaseToken !== row.leaseToken || current.state !== 'RUNNING') throw new ConflictException('Studio generation became stale');
    await this.assertOwned(org, row);
    const assets = await this.director.prepareAssets(config, row, dir);
    if (assets.find(a => a.mediaId === row.sourceMediaId)?.sha256 !== evidence.sourceSha256) throw new ConflictException('Studio source bytes changed');
    const plan = await this.director.produce(config, row, raw, assets, dir);
    await this.assertOwned(org, row);
    const active = await this.jobs.get(org, row.id);
    if (active.generation !== row.generation || active.state !== 'RUNNING' || active.leaseToken !== row.leaseToken) throw new ConflictException('Studio job became stale');
    await this.renderApproved(org, row.id, plan);
    await writeFile(join(dir, 'producer-status.json'), JSON.stringify({ phase: 'TECHNICAL_READY' }));
  }
  async framing(org: string, media: string) {
    const candidates = await this.db.studioEditJob.findMany({ where: { organizationId: org, sourceMediaId: media, state: 'REVIEWED' }, orderBy: { createdAt: 'desc' }, take: 5 });
    for (const row of candidates) {
      try {
        await this.assertOwned(org, row); const c = await studioRuntime(org);
        const evidence = validateStudioEvidence(await studioJson(join(studioDirectory(c, row), 'evidence.json')), { organizationId: org, mediaId: media });
        const framing = (row.input as any).request.creative?.framing;
        if (framing) return { framing: { ...framing, sourceSha256: evidence.sourceSha256 } };
      } catch {}
    }
    return { framing: null };
  }
  private async assertOwned(org: string, row: { input: unknown }) {
    const snapshot = row.input as any;
    const ids = snapshot.media.map((asset: any) => asset.id);
    const owned = await this.db.media.findMany({ where: { organizationId: org, deletedAt: null, id: { in: ids } }, select: { id: true, path: true } });
    if (owned.length !== ids.length || snapshot.media.some((asset: any) => !owned.some(current => current.id === asset.id && current.path === asset.path))) {
      throw new NotFoundException('Studio source or B-roll was removed');
    }
  }
  async storeOutput(org: string, job: string, generation: number, lease: string, path: string, sha256: string, bytes: number) {
    const row = await this.jobs.get(org, job);
    await this.assertOwned(org, row);
    const intent = await this.jobs.bindOutput(org, job, generation, lease, sha256, bytes);
    const receipt = await this.storage.storeStudioOutput(path, intent);
    await this.assertOwned(org, row);
    // Cancellation or generation changes during I/O cannot promote the result.
    // Immutable staged objects remain tracked by intent, never blindly deleted.
    return this.jobs.recordStored(intent, lease, receipt);
  }
  async renderApproved(org: string, job: string, plan: StudioApprovedPlan) {
    const config = await studioRuntime(org);
    let row = await this.jobs.get(org, job); await this.assertOwned(org, row);
    if (row.state === 'ADMITTED') row = await this.jobs.claim(org, job, row.generation);
    if (!row.leaseToken || row.state === 'CANCELLED') throw new ConflictException('Studio job is not runnable');
    const staged = await stageStudioPlan(config, row, plan);
    const worker = { root: config.root, file: config.file, work: config.work, planHash: studioFingerprint(plan),
      manifestHash: await studioHashFile(staged.manifestPath) };
    await this.jobs.bindWorker(org, job, row.generation, row.leaseToken, worker);
    if (['TECHNICAL_READY', 'REVIEWED'].includes(row.state)) return this.status(org, job);
    const result = await runStudioProject(config, row, plan);
    // Bind the private worker final; do not upload to public permanent storage
    // before the explicit review request authorizes saving that exact version.
    await this.jobs.bindOutput(org, job, row.generation, row.leaseToken, result.accepted.sha256, result.bytes);
    await this.assertOwned(org, row);
    await this.jobs.markTechnical(org, job, row.generation, row.leaseToken, result.accepted);
    return this.status(org, job);
  }
  private async verified(org: string, row: any) {
    await this.assertOwned(org, row);
    const config = await studioRuntime(org), worker = row.worker;
    if (!worker || worker.root !== config.root || worker.file !== config.file || worker.work !== config.work ||
        await studioHashFile(join(studioDirectory(config, row), 'manifest.json')) !== worker.manifestHash) throw new Error('Studio worker binding is stale');
    const result = await inspectStudioExport(config, row);
    if (studioFingerprint(result.accepted) !== studioFingerprint(row.technicalReceipt) || result.accepted.sha256 !== row.artifactSha256 || result.bytes !== row.artifactBytes) throw new Error('Studio acceptance changed');
    await this.assertOwned(org, row);
    return result;
  }
  async list(org: string) {
    // Metadata only, organization-scoped recovery after refresh. No worker paths,
    // transcript, raw receipts or cross-tenant identifiers leave this service.
    return this.db.studioEditJob.findMany({ where: { organizationId: org }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20,
      select: { id: true, sourceMediaId: true, state: true, generation: true, createdAt: true } });
  }
  async status(org: string, job: string) {
    const row = await this.jobs.get(org, job); await this.assertOwned(org, row);
    const response = { id: row.id, sourceMediaId: row.sourceMediaId, generation: row.generation, state: row.state,
      technicalStatus: 'NOT_VERIFIED', creativeApproval: row.reviewedAt ? 'APPROVED' : 'PENDING' };
    if (!['TECHNICAL_READY', 'REVIEWED'].includes(row.state)) {
      try { const c = await studioRuntime(org), progress = await studioJson(join(studioDirectory(c, row), 'producer-status.json'), 4096);
        if (progress.phase === 'NEEDS_VERIFICATION') return { ...response, phase: 'NEEDS_VERIFICATION', message: 'This edit needs verification or adjustment. No automatic paid retry will run. Your original is unchanged.' };
        if (progress.phase === 'WAITING_FOR_WORKER') return { ...response, phase: 'WAITING_FOR_WORKER', message: 'The native editor was busy, restarting or not ready. No new job was admitted. Resume when it is available; your original is unchanged.' };
      } catch {}
      return response;
    }
    try { await this.verified(org, row); }
    catch { return { ...response, technicalStatus: 'STALE_NEEDS_VERIFICATION' }; }
    return { ...response, technicalStatus: 'PASS', sha256: row.artifactSha256, preview: true,
      outputMediaId: row.outputMediaId, savedPath: row.state === 'REVIEWED' ? row.storagePath : undefined,
      limitations: (row.technicalReceipt as any).limitations, safeZoneProfiles: (row.technicalReceipt as any).safeZoneProfiles };
  }
  async preview(org: string, job: string, range?: string) {
    const row = await this.jobs.get(org, job);
    if (!['TECHNICAL_READY', 'REVIEWED'].includes(row.state)) throw new ConflictException('Studio preview is not ready');
    let result: Awaited<ReturnType<StudioEditService['verified']>>;
    try { result = await this.verified(org, row); } catch { throw new ServiceUnavailableException('Studio preview needs verification'); }
    let start = 0, end = result.bytes - 1, status = 200;
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m || !Number.isSafeInteger(+m[1]) || +m[1] >= result.bytes) throw new BadRequestException('Invalid preview range');
      start = +m[1]; end = m[2] ? Math.min(+m[2], end) : end;
      if (!Number.isSafeInteger(end) || end < start) throw new BadRequestException('Invalid preview range');
      status = 206;
    }
    return { stream: createReadStream(result.file, { start, end }), start, end, bytes: result.bytes, status };
  }
  async review(org: string, job: string, user: string, body: any) {
    if (!body || Object.keys(body).sort().join(',') !== 'generation,reviewed,sha256' || body.reviewed !== true ||
        !Number.isSafeInteger(body.generation) || !/^[a-f0-9]{64}$/.test(body.sha256 || '') || typeof user !== 'string' || !user) throw new BadRequestException('Confirm review of the current video');
    const row = await this.jobs.get(org, job);
    if (body.generation !== row.generation || body.sha256 !== row.artifactSha256) throw new ConflictException('Review the current Studio version');
    let result: Awaited<ReturnType<StudioEditService['verified']>>;
    try { result = await this.verified(org, row); } catch { throw new ServiceUnavailableException('The Studio result needs verification before it can be saved'); }
    // Persist consent before the first potentially public storage operation.
    await this.jobs.authorizeReviewedStorage(org, job, user, row.generation, row.artifactSha256!);
    const intent = { organizationId: org, jobId: job, generation: row.generation, sha256: row.artifactSha256!, bytes: row.artifactBytes! };
    const receipt = await this.storage.storeStudioOutput(result.file, intent);
    await this.assertOwned(org, row);
    await this.jobs.recordReviewedStorage(intent, receipt);
    return { outputMedia: await this.jobs.review(org, job, user, body.generation, body.sha256, studioFingerprint(row.technicalReceipt)) };
  }
  cancel(org: string, job: string) { return this.jobs.cancel(org, job); }
}
