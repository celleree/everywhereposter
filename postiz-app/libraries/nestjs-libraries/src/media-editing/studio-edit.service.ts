import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { join } from 'path';
import { PrismaService } from '../database/prisma/prisma.service';
import { UploadFactory } from '../upload/upload.factory';
import { StudioEditRepository, StudioEditRequest } from './studio-edit.repository';
import { studioFingerprint } from './studio-receipt';
import { StudioApprovedPlan, inspectStudioExport, runStudioProject, stageStudioPlan, studioDirectory, studioHashFile, studioRuntime } from './studio-worker';

// Authored plans enter through the internal worker method, never HTTP paths or
// uncharged model inference. Technical readiness does not authorize publishing.
@Injectable()
export class StudioEditService {
  private readonly storage = UploadFactory.createStorage();
  constructor(private readonly jobs: StudioEditRepository, private readonly db: PrismaService) {}
  admit(org: string, body: StudioEditRequest) { return this.jobs.admit(org, body); }
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
    if (row.state !== 'OUTPUT_STORED_UNVERIFIED') await this.storeOutput(org, job, row.generation, row.leaseToken, result.file, result.accepted.sha256, result.bytes);
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
    const stored = await this.storage.storeStudioOutput(result.file, { organizationId: org, jobId: row.id,
      generation: row.generation, sha256: row.artifactSha256, bytes: row.artifactBytes });
    if (stored.key !== row.artifactKey || stored.path !== row.storagePath) throw new Error('Studio stored object changed');
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
    if (!['TECHNICAL_READY', 'REVIEWED'].includes(row.state)) return response;
    try { await this.verified(org, row); }
    catch { return { ...response, technicalStatus: 'STALE_NEEDS_VERIFICATION' }; }
    return { ...response, technicalStatus: 'PASS', sha256: row.artifactSha256, preview: row.storagePath,
      outputMediaId: row.outputMediaId, limitations: (row.technicalReceipt as any).limitations, safeZoneProfiles: (row.technicalReceipt as any).safeZoneProfiles };
  }
  async review(org: string, job: string, user: string, body: any) {
    if (!body || Object.keys(body).sort().join(',') !== 'generation,reviewed,sha256' || body.reviewed !== true ||
        !Number.isSafeInteger(body.generation) || !/^[a-f0-9]{64}$/.test(body.sha256 || '') || typeof user !== 'string' || !user) throw new BadRequestException('Confirm review of the current video');
    const row = await this.jobs.get(org, job);
    if (body.generation !== row.generation || body.sha256 !== row.artifactSha256) throw new ConflictException('Review the current Studio version');
    try { await this.verified(org, row); } catch { throw new ServiceUnavailableException('The Studio result needs verification before it can be saved'); }
    return { outputMedia: await this.jobs.review(org, job, user, body.generation, body.sha256, studioFingerprint(row.technicalReceipt)) };
  }
  cancel(org: string, job: string) { return this.jobs.cancel(org, job); }
}
