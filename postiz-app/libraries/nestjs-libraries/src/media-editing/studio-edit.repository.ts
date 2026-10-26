import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma/prisma.service';
import { StudioOutputIntent, StudioOutputReceipt, studioOutputKey } from '../upload/upload.interface';
import { studioFingerprint } from './studio-receipt';
import { Prisma } from '@prisma/client';
import { StudioFraming, validateStudioFraming } from './studio-evidence';

export type StudioEditRequest = { requestKey: string; sourceMediaId: string; brollMediaIds: string[];
  destinations: string[]; profile: 'easy-graphics-v1'; creative?: { brief: string; framing: StudioFraming } };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const destinations = ['instagram', 'facebook', 'threads', 'tiktok', 'youtube', 'linkedin', 'x', 'pinterest', 'reddit', 'dribbble'];
export function normalizeStudioRequest(body: StudioEditRequest): StudioEditRequest {
  if (!body || Object.keys(body).some(k => !['brollMediaIds', 'destinations', 'profile', 'requestKey', 'sourceMediaId', 'creative'].includes(k)) ||
      typeof body.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestKey) || !id(body.sourceMediaId) || body.profile !== 'easy-graphics-v1' ||
      !Array.isArray(body.brollMediaIds) || body.brollMediaIds.length < 1 || body.brollMediaIds.length > 8 ||
      body.brollMediaIds.some(asset => !id(asset) || asset === body.sourceMediaId) ||
      new Set(body.brollMediaIds).size !== body.brollMediaIds.length || !Array.isArray(body.destinations) ||
      !body.destinations.length || body.destinations.length > 10 || body.destinations.some(value => !destinations.includes(value)) ||
      new Set(body.destinations).size !== body.destinations.length) throw new BadRequestException('Invalid Studio edit request');
  let creative: StudioEditRequest['creative'];
  if (body.creative !== undefined) {
    if (!body.creative || Object.keys(body.creative).sort().join(',') !== 'brief,framing' || typeof body.creative.brief !== 'string' ||
        !body.creative.brief.trim() || body.creative.brief.length > 1000) throw new BadRequestException('Describe the edit and confirm its stationary speaker framing');
    try { creative = { brief: body.creative.brief.trim(), framing: validateStudioFraming(body.creative.framing) }; }
    catch { throw new BadRequestException('Confirm one stationary speaker; moving or multiple speakers need adjustment'); }
  }
  return { requestKey: body.requestKey, sourceMediaId: body.sourceMediaId, brollMediaIds: [...body.brollMediaIds].sort(),
    destinations: [...body.destinations].sort(), profile: body.profile, ...(creative ? { creative } : {}) };
}

@Injectable()
export class StudioEditRepository {
  constructor(private readonly db: PrismaService) {}
  async admit(org: string, body: StudioEditRequest) {
    if (!id(org)) throw new BadRequestException('Invalid organization');
    const request = normalizeStudioRequest(body), requestHash = fingerprint(request);
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${org + ':studio:' + request.requestKey}, 0))`;
      const prior = await tx.studioEditJob.findUnique({ where: { organizationId_requestKey: { organizationId: org, requestKey: request.requestKey } } });
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ConflictException('This Studio request already belongs to different input');
        return prior;
      }
      const ids = [request.sourceMediaId, ...request.brollMediaIds];
      const media = await tx.media.findMany({ where: { organizationId: org, deletedAt: null, id: { in: ids } },
        select: { id: true, path: true, type: true, updatedAt: true, fileSize: true } });
      if (media.length !== ids.length || media.some(asset => !['image', 'video'].includes(asset.type)) ||
          media.find(asset => asset.id === request.sourceMediaId)?.type !== 'video') throw new NotFoundException('Studio source or B-roll is unavailable');
      const input = { request, media: [...media].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(asset => ({ ...asset, updatedAt: asset.updatedAt.toISOString() })),
        contentIdentity: 'UNVERIFIED_UNTIL_WORKER_HASHES_BYTES' };
      return tx.studioEditJob.create({ data: { organizationId: org, sourceMediaId: request.sourceMediaId,
        requestKey: request.requestKey, requestHash, inputFingerprint: fingerprint(input), input } });
    });
  }
  async get(org: string, job: string) {
    const row = await this.db.studioEditJob.findFirst({ where: { id: job, organizationId: org } });
    if (!row) throw new NotFoundException('Studio job not found');
    return row;
  }
  async claim(org: string, job: string, generation: number) {
    const leaseToken = randomUUID();
    const changed = await this.db.studioEditJob.updateMany({ where: { id: job, organizationId: org, generation, state: 'ADMITTED' },
      data: { state: 'RUNNING', leaseToken } });
    if (changed.count !== 1) throw new ConflictException('Studio job is already claimed or cancelled');
    const row = await this.get(org, job);
    if (row.state !== 'RUNNING' || row.generation !== generation || row.leaseToken !== leaseToken) throw new ConflictException('Studio claim became stale');
    return row;
  }
  async bindOutput(org: string, job: string, generation: number, leaseToken: string, sha256: string, bytes: number) {
    const intent: StudioOutputIntent = { organizationId: org, jobId: job, generation, sha256, bytes };
    const key = studioOutputKey(intent);
    const changed = await this.db.studioEditJob.updateMany({ where: { id: job, organizationId: org, generation, leaseToken,
      state: 'RUNNING', artifactKey: null }, data: { artifactKey: key, artifactSha256: sha256, artifactBytes: bytes } });
    const row = await this.get(org, job);
    if ((!changed.count && row.artifactKey !== key) || row.artifactSha256 !== sha256 || row.artifactBytes !== bytes || row.generation !== generation || row.leaseToken !== leaseToken ||
        !['RUNNING', 'OUTPUT_STORED_UNVERIFIED'].includes(row.state)) throw new ConflictException('Studio output changed or the job was cancelled');
    return intent;
  }
  async recordStored(intent: StudioOutputIntent, leaseToken: string, receipt: StudioOutputReceipt) {
    if (receipt.key !== studioOutputKey(intent) || receipt.sha256 !== intent.sha256 || receipt.bytes !== intent.bytes || !receipt.path) throw new ConflictException('Studio storage receipt mismatch');
    const changed = await this.db.studioEditJob.updateMany({ where: { id: intent.jobId, organizationId: intent.organizationId,
      generation: intent.generation, leaseToken, artifactKey: receipt.key, state: 'RUNNING' },
      data: { state: 'OUTPUT_STORED_UNVERIFIED', storagePath: receipt.path } });
    const row = await this.get(intent.organizationId, intent.jobId);
    if (!changed.count && (row.state !== 'OUTPUT_STORED_UNVERIFIED' || row.storagePath !== receipt.path ||
        row.generation !== intent.generation || row.leaseToken !== leaseToken)) throw new ConflictException('Studio output completion is stale');
    return row;
  }
  async cancel(org: string, job: string) {
    const changed = await this.db.studioEditJob.updateMany({ where: { id: job, organizationId: org,
      state: { in: ['ADMITTED', 'RUNNING'] }, generation: { lt: 10000 } }, data: { state: 'CANCELLED', generation: { increment: 1 }, leaseToken: null } });
    const row = await this.get(org, job);
    if (!changed.count && row.state !== 'CANCELLED') throw new ConflictException('Studio job can no longer be cancelled');
    return row;
  }
  async bindWorker(org: string, job: string, generation: number, leaseToken: string, worker: Prisma.InputJsonObject) {
    const changed = await this.db.studioEditJob.updateMany({ where: { id: job, organizationId: org, generation, leaseToken,
      state: 'RUNNING', worker: { equals: Prisma.DbNull } }, data: { worker } });
    const row = await this.get(org, job);
    if ((!changed.count && studioFingerprint(row.worker) !== studioFingerprint(worker)) || row.generation !== generation ||
        row.leaseToken !== leaseToken || !['RUNNING', 'OUTPUT_STORED_UNVERIFIED', 'TECHNICAL_READY', 'REVIEWED'].includes(row.state)) throw new ConflictException('Studio worker identity changed');
    return row;
  }
  async markTechnical(org: string, job: string, generation: number, leaseToken: string, receipt: any) {
    const changed = await this.db.studioEditJob.updateMany({ where: { id: job, organizationId: org, generation, leaseToken,
      state: { in: ['RUNNING', 'OUTPUT_STORED_UNVERIFIED'] }, artifactSha256: receipt.sha256 }, data: { state: 'TECHNICAL_READY', technicalReceipt: receipt } });
    const row = await this.get(org, job);
    if (!changed.count && (!['TECHNICAL_READY', 'REVIEWED'].includes(row.state) || row.generation !== generation || row.leaseToken !== leaseToken ||
        studioFingerprint(row.technicalReceipt) !== studioFingerprint(receipt))) throw new ConflictException('Studio technical completion is stale');
    return row;
  }
  async authorizeReviewedStorage(org: string, job: string, user: string, generation: number, sha256: string) {
    await this.db.studioEditJob.updateMany({ where: { id: job, organizationId: org, generation, artifactSha256: sha256,
      state: 'TECHNICAL_READY', reviewedAt: null }, data: { reviewedAt: new Date(), reviewedByUserId: user } });
    const row = await this.get(org, job);
    if (!['TECHNICAL_READY', 'REVIEWED'].includes(row.state) || row.generation !== generation || row.artifactSha256 !== sha256 || !row.reviewedAt) throw new ConflictException('Studio review became stale');
    return row;
  }
  async recordReviewedStorage(intent: StudioOutputIntent, receipt: StudioOutputReceipt) {
    if (receipt.key !== studioOutputKey(intent) || receipt.sha256 !== intent.sha256 || receipt.bytes !== intent.bytes || !receipt.path) throw new ConflictException('Studio storage receipt mismatch');
    await this.db.studioEditJob.updateMany({ where: { id: intent.jobId, organizationId: intent.organizationId, generation: intent.generation,
      state: 'TECHNICAL_READY', reviewedAt: { not: null }, artifactKey: receipt.key, artifactSha256: receipt.sha256, storagePath: null }, data: { storagePath: receipt.path } });
    const row = await this.get(intent.organizationId, intent.jobId);
    if (!row.reviewedAt || !['TECHNICAL_READY', 'REVIEWED'].includes(row.state) || row.generation !== intent.generation || row.artifactKey !== receipt.key || row.storagePath !== receipt.path) throw new ConflictException('Studio reviewed storage is stale');
    return row;
  }
  async review(org: string, job: string, user: string, generation: number, sha256: string, technicalFingerprint: string) {
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${org + ':studio-review:' + job}, 0))`;
      const row = await tx.studioEditJob.findFirst({ where: { id: job, organizationId: org } });
      if (!row || !['TECHNICAL_READY', 'REVIEWED'].includes(row.state) || row.generation !== generation || row.artifactSha256 !== sha256 ||
          !row.storagePath || !row.reviewedAt || studioFingerprint(row.technicalReceipt) !== technicalFingerprint) throw new ConflictException('Review the current verified Studio result');
      const ids = (row.input as any).media.map((m: any) => m.id);
      const active = await tx.media.findMany({ where: { id: { in: ids }, organizationId: org, deletedAt: null }, select: { id: true, path: true } });
      if (active.length !== ids.length || (row.input as any).media.some((m: any) => !active.some(a => a.id === m.id && a.path === m.path))) throw new NotFoundException('Studio source or B-roll was removed');
      if (row.outputMediaId) {
        const media = await tx.media.findFirst({ where: { id: row.outputMediaId, organizationId: org, deletedAt: null } });
        if (!media || media.path !== row.storagePath) throw new NotFoundException('Saved Studio result is unavailable');
        return media;
      }
      const media = await tx.media.create({ data: { id: 'studio-' + row.id, organizationId: org, name: 'studio-' + row.id + '.mp4',
        originalName: 'reviewed-studio-edit.mp4', path: row.storagePath, type: 'video', fileSize: row.artifactBytes! } });
      await tx.studioEditJob.update({ where: { id: row.id }, data: { state: 'REVIEWED', outputMediaId: media.id } });
      return media;
    });
  }
}
