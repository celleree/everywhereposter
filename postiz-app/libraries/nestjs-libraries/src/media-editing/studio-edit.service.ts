import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma/prisma.service';
import { UploadFactory } from '../upload/upload.factory';
import { StudioEditRepository, StudioEditRequest } from './studio-edit.repository';

// Internal application primitives only: worker/HTTP binding and QA acceptance
// await the real package contract. This service never marks an export ready.
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
}
