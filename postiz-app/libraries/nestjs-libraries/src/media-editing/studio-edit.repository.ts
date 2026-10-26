import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma/prisma.service';
import { StudioOutputIntent, StudioOutputReceipt, studioOutputKey } from '../upload/upload.interface';

export type StudioEditRequest = { requestKey: string; sourceMediaId: string; brollMediaIds: string[];
  destinations: string[]; profile: 'easy-graphics-v1' };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const destinations = ['instagram', 'facebook', 'threads', 'tiktok', 'youtube', 'linkedin', 'x', 'pinterest', 'reddit', 'dribbble'];
export function normalizeStudioRequest(body: StudioEditRequest): StudioEditRequest {
  if (!body || Object.keys(body).sort().join(',') !== 'brollMediaIds,destinations,profile,requestKey,sourceMediaId' ||
      typeof body.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestKey) || !id(body.sourceMediaId) || body.profile !== 'easy-graphics-v1' ||
      !Array.isArray(body.brollMediaIds) || body.brollMediaIds.length < 1 || body.brollMediaIds.length > 8 ||
      body.brollMediaIds.some(asset => !id(asset) || asset === body.sourceMediaId) ||
      new Set(body.brollMediaIds).size !== body.brollMediaIds.length || !Array.isArray(body.destinations) ||
      !body.destinations.length || body.destinations.length > 10 || body.destinations.some(value => !destinations.includes(value)) ||
      new Set(body.destinations).size !== body.destinations.length) throw new BadRequestException('Invalid Studio edit request');
  return { requestKey: body.requestKey, sourceMediaId: body.sourceMediaId, brollMediaIds: [...body.brollMediaIds].sort(),
    destinations: [...body.destinations].sort(), profile: body.profile };
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
}
