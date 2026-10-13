import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, VideoUploadSession } from '@prisma/client';
import { PrismaService } from '../database/prisma/prisma.service';
import { CreateVideoUploadDto } from '../dtos/media/create.video.upload.dto';
import { ACTIVE_UPLOAD_STATES, UPLOAD_FREE_FLOOR, UPLOAD_TTL_MS, VIDEO_CHUNK_BYTES, VIDEO_MAX_BYTES, validateVideoOnDisk } from './resumable-video.validation';
import { createReadStream, createWriteStream } from 'fs';
import { lstat, mkdir, open, realpath, rename, rm, statfs, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { createHash, randomUUID } from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

type Tx = Prisma.TransactionClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_SELECT = { id: true, name: true, originalName: true, path: true, type: true, thumbnail: true, alt: true };

@Injectable()
export class ResumableUploadService {
  constructor(private readonly db: PrismaService) {}

  private async locked<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(99164801)`;
      return work(tx);
    }, { timeout: 15_000 });
  }

  private async directory(id?: string) {
    if (process.env.STORAGE_PROVIDER !== 'local' || !process.env.UPLOAD_DIRECTORY) {
      throw new BadRequestException('Resumable uploads require local storage.');
    }
    const root = await realpath(process.env.UPLOAD_DIRECTORY);
    const staging = join(root, '.resumable');
    await mkdir(staging, { recursive: true, mode: 0o700 });
    if ((await realpath(staging)) !== staging || !(await lstat(staging)).isDirectory()) {
      throw new ServiceUnavailableException('Upload staging is unsafe.');
    }
    if (!id) return staging;
    if (!UUID.test(id)) throw new NotFoundException('Upload not found.');
    const dir = join(staging, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await realpath(dir)) !== dir || !(await lstat(dir)).isDirectory()) {
      throw new ServiceUnavailableException('Upload staging is unsafe.');
    }
    return dir;
  }

  private async owned(tx: Tx, org: string, id: string) {
    const session = await tx.videoUploadSession.findFirst({ where: { id, organizationId: org } });
    if (!session) throw new NotFoundException('Upload not found.');
    return session;
  }

  private assertActive(session: VideoUploadSession) {
    if (!ACTIVE_UPLOAD_STATES.includes(session.status) || (session.status !== 'FINALIZING' && session.expiresAt <= new Date())) {
      throw new ConflictException('Upload is complete, cancelled, failed or expired.');
    }
  }

  private async space(tx: Tx, additional = 0) {
    const pending = await tx.videoUploadSession.findMany({ where: { status: { in: ACTIVE_UPLOAD_STATES } } });
    let reserve = additional;
    for (const row of pending) {
      const dir = await this.directory(row.id);
      let allocated = 0;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isFile()) allocated += (await lstat(join(dir, entry.name))).size;
      }
      const extension = /\.mov$/i.test(row.originalName) ? 'mov' : 'mp4';
      try { allocated += (await lstat(join(await realpath(process.env.UPLOAD_DIRECTORY!), 'videos', `${row.id}.${extension}`))).size; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      reserve += Math.max(0, 2 * row.byteSize + VIDEO_CHUNK_BYTES - allocated);
    }
    const fs = await statfs(await this.directory());
    if (fs.bavail * fs.bsize < UPLOAD_FREE_FLOOR + reserve) {
      throw new ServiceUnavailableException('Upload storage is full. Try again after freeing media storage.');
    }
  }

  async create(org: string, actor: string, input: CreateVideoUploadDto) {
    if (input.organizationId !== org) throw new ConflictException('Organization changed. Return to the original workspace.');
    if (input.manifest.length !== Math.ceil(input.byteSize / VIDEO_CHUNK_BYTES)) {
      throw new BadRequestException('The complete file digest manifest is required.');
    }
    const id = await this.locked(async (tx) => {
      const previous = await tx.videoUploadSession.findUnique({ where: { organizationId_clientId: { organizationId: org, clientId: input.clientId } } });
      if (previous) {
        if (previous.byteSize !== input.byteSize || previous.originalName !== input.originalName || JSON.stringify(previous.manifest) !== JSON.stringify(input.manifest)) {
          throw new ConflictException('This upload identity belongs to a different file.');
        }
        return previous.id;
      }
      const active = await tx.videoUploadSession.findMany({ where: { status: { in: ACTIVE_UPLOAD_STATES } } });
      if (active.length >= 2 || active.some((row) => row.organizationId === org)) {
        throw new ConflictException('Upload limit reached. Resume or cancel an existing upload first.');
      }
      const recent = await tx.videoUploadSession.count({ where: { organizationId: org, createdAt: { gt: new Date(Date.now() - UPLOAD_TTL_MS) } } });
      if (recent >= 10) throw new ConflictException('Daily upload session quota reached.');
      await this.space(tx, input.byteSize * 2 + VIDEO_CHUNK_BYTES);
      return (await tx.videoUploadSession.create({ data: {
        clientId: input.clientId, originalName: input.originalName, byteSize: input.byteSize, manifest: input.manifest,
        organizationId: org, creatorId: actor, expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
      } })).id;
    });
    return this.get(org, id);
  }

  async list(org: string) {
    const rows = await this.db.videoUploadSession.findMany({ where: { organizationId: org, status: { in: [...ACTIVE_UPLOAD_STATES, 'COMPLETE', 'FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 20 });
    return { durableQuickUploadEnabled: process.env.ENABLE_DURABLE_QUICK_UPLOAD === 'true', chunkBytes: VIDEO_CHUNK_BYTES, maxBytes: VIDEO_MAX_BYTES, sessions: await Promise.all(rows.map((row) => this.get(org, row.id))) };
  }

  async get(org: string, id: string) {
    const row = await this.db.videoUploadSession.findFirst({ where: { id, organizationId: org }, include: { quickIntent: { select: { id: true, status: true, results: true, message: true, consentVersion: true } }, parts: { select: { index: true, digest: true, byteSize: true } }, media: { select: MEDIA_SELECT } } });
    if (!row) throw new NotFoundException('Upload not found.');
    return { quickIntent: row.quickIntent, id: row.id, clientId: row.clientId, originalName: row.originalName, byteSize: row.byteSize, manifest: row.manifest, status: row.status, expiresAt: row.expiresAt, parts: row.parts, media: row.media, error: row.error, chunkBytes: VIDEO_CHUNK_BYTES, maxBytes: VIDEO_MAX_BYTES };
  }

  private async claim(org: string, id: string, finalize: boolean) {
    return this.locked(async (tx) => {
      const row = await this.owned(tx, org, id);
      this.assertActive(row);
      const now = new Date();
      if (row.leaseUntil && row.leaseUntil > now) throw new ConflictException('An upload request is still running. Wait before resuming.');
      const busy = await tx.videoUploadSession.count({ where: { leaseUntil: { gt: now }, ...(finalize ? { status: 'FINALIZING' } : {}) } });
      if (busy >= (finalize ? 1 : 2)) throw new ConflictException('Upload requests are busy. Try again shortly.');
      if (!finalize && row.status !== 'UPLOADING') throw new ConflictException('Finalization has already started.');
      if (finalize && await tx.videoUploadPart.count({ where: { sessionId: id } }) !== row.manifest.length) throw new ConflictException('Upload parts are missing.');
      await this.space(tx);
      return tx.videoUploadSession.update({ where: { id }, data: {
        status: finalize ? 'FINALIZING' : 'UPLOADING', generation: { increment: 1 }, leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() + (finalize ? 10 * 60_000 : 3 * 60_000)), expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
      } });
    });
  }

  private async fence(tx: Tx, claim: VideoUploadSession) {
    const current = await this.owned(tx, claim.organizationId, claim.id);
    if (current.leaseToken !== claim.leaseToken || current.generation !== claim.generation || !current.leaseUntil || current.leaseUntil <= new Date()) {
      throw new ConflictException('This upload request expired. Resume to reconcile it.');
    }
    return current;
  }

  async part(org: string, id: string, index: number, stream: Readable, length?: string) {
    const claim = await this.claim(org, id, false);
    let temporary: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!Number.isInteger(index) || index < 0 || index >= claim.manifest.length) throw new BadRequestException('Invalid chunk index.');
      const expected = Math.min(VIDEO_CHUNK_BYTES, claim.byteSize - index * VIDEO_CHUNK_BYTES);
      if (length && Number(length) !== expected) throw new BadRequestException('Invalid chunk length.');
      const dir = await this.directory(id);
      temporary = join(dir, `${claim.leaseToken}.tmp`);
      const finalPart = join(dir, `${index}-${claim.leaseToken}.part`);
      let bytes = 0;
      const hash = createHash('sha256');
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 120_000);
      const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(), 30_000); };
      resetIdle();
      const limiter = new Transform({ transform(chunk, _encoding, callback) {
        resetIdle(); bytes += chunk.length;
        if (bytes > expected) return callback(new BadRequestException('Chunk exceeds its reserved size.'));
        hash.update(chunk); callback(null, chunk);
      } });
      await pipeline(stream, limiter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
      if (bytes !== expected || hash.digest('hex') !== claim.manifest[index]) throw new ConflictException('Chunk content does not match the original file.');
      const file = await open(temporary, 'r');
      try { await file.sync(); } finally { await file.close(); }
      await this.locked(async (tx) => {
        await this.fence(tx, claim);
        const previous = await tx.videoUploadPart.findUnique({ where: { sessionId_index: { sessionId: id, index } } });
        if (!previous) {
          await rename(temporary!, finalPart);
          await this.syncDirectory(dir);
          await tx.videoUploadPart.create({ data: { sessionId: id, index, digest: claim.manifest[index], byteSize: bytes, token: claim.leaseToken! } });
        }
        await tx.videoUploadSession.update({ where: { id }, data: { leaseToken: null, leaseUntil: null, expiresAt: new Date(Date.now() + UPLOAD_TTL_MS) } });
      });
      return this.get(org, id);
    } finally {
      clearTimeout(timer); clearTimeout(idle);
      if (temporary) await rm(temporary, { force: true });
      await this.db.videoUploadSession.updateMany({ where: { id, leaseToken: claim.leaseToken, generation: claim.generation }, data: { leaseToken: null, leaseUntil: null } });
    }
  }

  private async syncDirectory(dir: string) {
    const handle = await open(dir, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }

  private async verifyManifest(path: string, session: VideoUploadSession) {
    let index = 0;
    let count = 0;
    let hash = createHash('sha256');
    for await (const data of createReadStream(path, { highWaterMark: VIDEO_CHUNK_BYTES })) {
      let offset = 0;
      while (offset < data.length) {
        const take = Math.min(VIDEO_CHUNK_BYTES - count, data.length - offset);
        hash.update(data.subarray(offset, offset + take)); count += take; offset += take;
        if (count === VIDEO_CHUNK_BYTES) {
          if (hash.digest('hex') !== session.manifest[index++]) throw new BadRequestException('Stored video content is invalid.');
          hash = createHash('sha256'); count = 0;
        }
      }
    }
    if (count && hash.digest('hex') !== session.manifest[index++]) throw new BadRequestException('Stored video content is invalid.');
    if (index !== session.manifest.length) throw new BadRequestException('Stored video is incomplete.');
  }

  async complete(org: string, id: string) {
    const status = await this.get(org, id);
    if (status.status === 'COMPLETE') return status;
    const claim = await this.claim(org, id, true);
    const dir = await this.directory(id);
    const assembled = join(dir, `${claim.leaseToken}.assembled`);
    const root = await realpath(process.env.UPLOAD_DIRECTORY!);
    const targetDir = join(root, 'videos');
    await mkdir(targetDir, { recursive: true });
    if (await realpath(targetDir) !== targetDir) throw new ServiceUnavailableException('Upload destination is unsafe.');
    // Extension is container-compatible; detected MIME, not client MIME, owns validation.
    const extension = /\.mov$/i.test(claim.originalName) ? 'mov' : 'mp4';
    const target = join(targetDir, `${id}.${extension}`);
    try {
      let candidate = target;
      try { await lstat(target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        candidate = assembled;
        const parts = await this.db.videoUploadPart.findMany({ where: { sessionId: id }, orderBy: { index: 'asc' } });
        async function* chunks() {
          for (const part of parts) {
            const path = join(dir, `${part.index}-${part.token}.part`);
            if (!(await lstat(path)).isFile() || await realpath(path) !== path) throw new BadRequestException('Upload part is unsafe.');
            yield* createReadStream(path);
          }
        }
        await pipeline(Readable.from(chunks()), createWriteStream(assembled, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.timeout(8 * 60_000) });
      }
      if (!(await lstat(candidate)).isFile() || await realpath(candidate) !== candidate) throw new BadRequestException('Upload file is unsafe.');
      await this.verifyManifest(candidate, claim);
      const detected = await validateVideoOnDisk(candidate, claim.byteSize);
      const file = await open(candidate, 'r');
      try { await file.sync(); } finally { await file.close(); }
      await this.locked(async (tx) => {
        await this.fence(tx, claim);
        if (candidate !== target) await rename(candidate, target);
        // Published media is readable by existing static-serving workers.
        const saved = await open(target, 'r');
        try { await saved.chmod(0o644); await saved.sync(); } finally { await saved.close(); }
        await this.syncDirectory(targetDir);
        await tx.media.upsert({ where: { id }, create: {
          id, organizationId: org, name: `${id}.${extension}`, originalName: claim.originalName,
          path: `${process.env.FRONTEND_URL}/uploads/videos/${id}.${extension}`, type: 'video', fileSize: claim.byteSize,
        }, update: {} });
        await tx.videoUploadSession.update({ where: { id }, data: { status: 'COMPLETE', mediaId: id, duration: detected.duration, mimeType: detected.mime, leaseToken: null, leaseUntil: null, error: null } });
      });
      return this.get(org, id);
    } catch (error) {
      // Transient/process failures retain FINALIZING for durable maintenance recovery.
      if (error instanceof BadRequestException) await this.db.videoUploadSession.updateMany({ where: { id, generation: claim.generation, leaseToken: claim.leaseToken }, data: { status: 'FAILED', error: error.message, leaseToken: null, leaseUntil: null } });
      throw error;
    } finally {
      await rm(assembled, { force: true });
      await this.db.videoUploadSession.updateMany({ where: { id, generation: claim.generation, leaseToken: claim.leaseToken }, data: { leaseToken: null, leaseUntil: null } });
    }
  }

  async cancel(org: string, id: string) {
    await this.locked(async (tx) => {
      const row = await this.owned(tx, org, id);
      if (row.status === 'COMPLETE' || row.status === 'FINALIZING' || (row.leaseUntil && row.leaseUntil > new Date())) throw new ConflictException('Wait for the current request to finish before cancellation.');
      await tx.videoUploadSession.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.maintain();
    return { cancelled: true };
  }

  async maintain() {
    const rows = await this.db.videoUploadSession.findMany({ where: {
      OR: [{ status: 'FINALIZING', OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
        { status: { in: ['UPLOADING', 'FAILED', 'CANCELLED'] }, stagingCleaned: false, OR: [{ expiresAt: { lte: new Date() } }, { status: { in: ['FAILED', 'CANCELLED'] } }] }, { status: 'COMPLETE', stagingCleaned: false }],
    }, orderBy: { updatedAt: 'asc' }, take: 20 });
    for (const row of rows) {
      if (row.status === 'FINALIZING') {
        try { await this.complete(row.organizationId, row.id); } catch { /* Busy/full sessions retain durable recovery state. */ }
      } else {
        await this.locked(async (tx) => {
          const current = await this.owned(tx, row.organizationId, row.id);
          if (current.leaseUntil && current.leaseUntil > new Date()) return;
          if (current.status === 'UPLOADING' && current.expiresAt > new Date()) return;
          if (!['UPLOADING', 'FAILED', 'CANCELLED', 'COMPLETE', 'EXPIRED'].includes(current.status)) return;
          // Only private session staging is removed; finalized videos and media receipts are never deleted.
          await rm(await this.directory(row.id), { recursive: true, force: true });
          await tx.videoUploadSession.update({ where: { id: row.id }, data: { stagingCleaned: true, ...(current.status === 'UPLOADING' ? { status: 'EXPIRED' } : {}) } });
        });
      }
    }
  }
}
