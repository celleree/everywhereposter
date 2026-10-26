import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { lstat, mkdtemp, rm, writeFile } from 'fs/promises';
import { isAbsolute, join } from 'path';
import { tmpdir } from 'os';
import { MediaRepository } from '../database/prisma/media/media.repository';
import { FfmpegVideoEditorService } from './ffmpeg-video-editor.service';
import { prepareEditorSource } from './video-editor-source';
import { CookedWorkerClient } from './cooked-worker-client';
import { cookedData, cookedState, trustedCookedHtml } from './cooked-review-boundary';
import { adaptCookedReviewHtml } from './cooked-review-html';
import { UploadFactory } from '../upload/upload.factory';
import type { UploadedFileReceipt } from '../upload/upload.interface';
import { studioHashFile, studioJson } from './studio-worker';
import { validateStudioEvidence } from './studio-evidence';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
@Injectable()
export class CookedReviewService {
  private readonly storage = UploadFactory.createStorage();
  private creating = false; private saving = false;
  private readonly saved = new Map<string, Awaited<ReturnType<MediaRepository['saveFile']>>>();
  constructor(private readonly media: MediaRepository, private readonly probe: FfmpegVideoEditorService) {}
  private configuration(org: string) {
    const socket = process.env.COOKED_EDITOR_SOCKET;
    const enabled = (process.env.COOKED_EDITOR_ORGANIZATIONS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (process.env.COOKED_EDITOR_ENABLED !== 'true' || !enabled.includes(org) || !socket || !isAbsolute(socket)) throw new ServiceUnavailableException('Word editing is unavailable.');
    return socket;
  }
  private async client(org: string) {
    const socket = this.configuration(org);
    try { const info = await lstat(socket); if (!info.isSocket() || info.isSymbolicLink()) throw new Error(); }
    catch { throw new ServiceUnavailableException('Word editing is unavailable.'); }
    return new CookedWorkerClient(socket);
  }
  private async readyClient(org: string) {
    // A closed session retires its entire worker namespace before a new one.
    for (let i = 0; i < 25; i++) {
      try { const c = await this.client(org); if ((await c.health()).ready === true) return c; } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new ServiceUnavailableException('The editor is restarting. Try again shortly.');
  }
  async status(org: string) {
    try { this.configuration(org); } catch { return { enabled: false, ready: false }; }
    // A worker restart must not mount the legacy editor and auto-render its
    // remembered source. Mode follows configuration; readiness can recover.
    try { const c = await this.client(org); return { enabled: true, ready: (await c.health()).ready === true }; }
    catch { return { enabled: true, ready: false }; }
  }
  private async owner(org: string, id: string) {
    if (!/^[\w-]{1,128}$/.test(id)) throw new NotFoundException();
    const source = await this.media.getMediaByOrganizationIdAndId(org, id);
    if (!source || source.type !== 'video') throw new NotFoundException('Video not found.');
    return source;
  }
  private job(id: string) { if (!UUID.test(id)) throw new NotFoundException(); return '/jobs/' + id; }
  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (e) {
      if (e instanceof HttpException) throw e;
      const status = (e as { status?: number }).status;
      throw new HttpException('The editor request could not be completed. Your original is unchanged.', status && [400, 403, 404, 409, 413, 422, 429].includes(status) ? status : 503);
    }
  }
  async find(org: string, id: string, request: string) {
    await this.owner(org, id); if (!UUID.test(request)) throw new BadRequestException();
    return this.safe(async () => (await this.client(org)).json('/find?request=' + request, org, id));
  }
  // Internal handoff only. Caller owns a retained private Studio directory; no
  // client path or native filesystem location is accepted through HTTP.
  async studioSource(org: string, id: string, requestId: string, dir: string, allowCreate: boolean) {
    const admission = { started: false, rejected: false };
    let prepared: Awaited<ReturnType<typeof prepareEditorSource>> | undefined;
    try {
      const source = await this.owner(org, id);
      prepared = await prepareEditorSource(source.path, source.originalName || source.name);
      const originalSha256 = await studioHashFile(prepared.inputPath), metadata = await this.probe.probeForCooked(prepared.inputPath);
      if (metadata.fps !== 30 || metadata.durationMs > 60_000 || Math.abs(metadata.width / metadata.height - 9 / 16) > .001) {
        throw new BadRequestException('Studio beta supports portrait CFR30 originals up to60seconds within the existing native resource limits');
      }
      const native = allowCreate ? await this.create(org, id, { requestId }, admission) : await this.find(org, id, requestId);
      if (native.status !== 'ready' || !UUID.test(native.jobId || '') || !Number.isSafeInteger(native.revision)) throw new ConflictException('Source evidence is still pending; no second native job was dispatched');
      const client = await this.client(org), raw = await client.studioEvidence(org, id, native.jobId, native.revision);
      if (raw.jobId !== native.jobId || raw.revision !== native.revision) throw new ConflictException('Native evidence revision changed');
      const evidence = validateStudioEvidence(raw, { organizationId: org, mediaId: id, sourceSha256: originalSha256 });
      const audio = join(dir, 'cooked-audio.mp4');
      try { await lstat(audio); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        await client.studioAudio(org, id, native.jobId, native.revision, evidence.audio.sha256, evidence.audio.bytes, audio);
      }
      if ((await lstat(audio)).size !== evidence.audio.bytes || await studioHashFile(audio) !== evidence.audio.sha256 ||
          await studioHashFile(prepared.inputPath) !== originalSha256) throw new ConflictException('Source or aligned audio changed');
      await this.owner(org, id);
      const snapshots = { 'cooked-decisions.json': raw.files.decisions.value, 'cooked-captions.json': raw.files.words.value,
        'cooked-receipt.json': raw, 'evidence.json': raw };
      for (const [name, value] of Object.entries(snapshots)) {
        const file = join(dir, name);
        try { await writeFile(file, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || JSON.stringify(await studioJson(file)) !== JSON.stringify(value)) throw e; }
      }
      // Exported custody survives native session close/expiry. Closing only this
      // request releases its temporary native copies, never the uploaded Media.
      await client.json('/find?request=' + requestId, org, id, 'DELETE').catch(() => {});
      return raw;
    } catch (error) {
      if (allowCreate && (!admission.started || admission.rejected)) throw Object.assign(new Error('Native admission was not dispatched'), { studioNotAdmitted: true });
      throw error;
    } finally { await prepared?.cleanup(); }
  }
  async create(org: string, id: string, body: { requestId: string }, admission?: { started: boolean; rejected: boolean }) {
    const source = await this.owner(org, id);
    if (!body || Object.keys(body).some(k => k !== 'requestId') || !UUID.test(body.requestId || '')) throw new BadRequestException();
    if (this.creating) throw new HttpException('Another video is being prepared.', 429);
    this.creating = true; let prepared: Awaited<ReturnType<typeof prepareEditorSource>> | undefined;
    try {
      const client = await this.readyClient(org);
      // Recovery reads never start a second native job.
      try { const existing = await client.json('/find?request=' + body.requestId, org, id); if (admission) admission.started = true; return existing; }
      catch (e) { if ((e as { status?: number }).status !== 404) throw e; }
      prepared = await prepareEditorSource(source.path, source.originalName || source.name);
      const metadata = await this.probe.probeForCooked(prepared.inputPath);
      const result = await this.safe(async () => {
        if (admission) admission.started = true;
        try { return await client.create(org, id, body.requestId, prepared!.inputPath, metadata); }
        catch (error) {
          // These explicit worker responses occur before POST /jobs inserts its
          // retained job. A timeout/connection loss/422 never proves non-dispatch.
          if (admission && [429, 503].includes((error as { status?: number }).status!)) admission.rejected = true;
          throw error;
        }
      });
      await this.owner(org, id); return result;
    } finally { await prepared?.cleanup().catch(() => {}); this.creating = false; }
  }
  async view(org: string, id: string, job: string, route: string, key?: string, range?: string) {
    await this.owner(org, id); const root = this.job(job);
    if (!['review', 'state', 'data', 'video', 'download'].includes(route) || (key && !/^(raw|cut-[1-9]\d{0,3})$/.test(key))) throw new NotFoundException();
    const path = `${root}/${route}${key ? '?k=' + key : ''}`;
    return this.safe(async () => {
      const c = await this.client(org);
      if (route === 'video' || route === 'download') return { stream: await c.stream(path, org, id, range) };
      const bytes = await c.bytes(path, org, id);
      return { bytes: route === 'review' ? Buffer.from(adaptCookedReviewHtml(trustedCookedHtml(bytes))) : Buffer.from(JSON.stringify(route === 'state' ? cookedState(JSON.parse(bytes.toString())) : cookedData(JSON.parse(bytes.toString())))) };
    });
  }
  async edit(org: string, id: string, job: string, body: unknown) {
    await this.owner(org, id); return this.safe(async () => (await this.client(org)).json(this.job(job) + '/edits', org, id, 'POST', body));
  }
  async remove(org: string, id: string, job: string) {
    await this.owner(org, id); if (!UUID.test(job)) throw new NotFoundException();
    return this.safe(async () => (await this.client(org)).json('/find?request=' + job, org, id, 'DELETE'));
  }
  async output(org: string, id: string, job: string, body: { revision: number }) {
    await this.owner(org, id); this.job(job);
    if (!body || Object.keys(body).some(k => k !== 'revision') || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new BadRequestException();
    const key = [org, id, job, body.revision].join(':'); const prior = this.saved.get(key);
    if (prior) {
      if (!await this.media.getMediaByOrganizationIdAndId(org, prior.id)) throw new NotFoundException();
      return { outputMedia: prior, revision: body.revision };
    }
    if (this.saving) throw new HttpException('Another copy is being saved.', 429);
    this.saving = true; let dir: string | undefined; let uploaded: UploadedFileReceipt | undefined;
    try {
      const client = await this.client(org); const state = await this.safe(async () => cookedState(await client.json(this.job(job) + '/state', org, id)));
      if (state.busy) throw new ConflictException('Finish applying changes before saving.');
      if (state.revision !== body.revision) throw new ConflictException('The edit changed. Review the current version before saving.');
      dir = await mkdtemp(join(tmpdir(), 'ep-cooked-output-')); const path = join(dir, 'output.mp4');
      await this.safe(() => client.download(org, id, job, state.round, path));
      await this.owner(org, id);
      uploaded = await this.storage.uploadFromPath(path, `edited-r${body.revision}.mp4`);
      await this.owner(org, id);
      const output = await this.media.saveFile(org, uploaded.filename, uploaded.path, uploaded.originalname, uploaded.mimetype);
      uploaded = undefined; if (this.saved.size >= 64) this.saved.delete(this.saved.keys().next().value!); this.saved.set(key, output);
      return { outputMedia: output, revision: body.revision };
    } finally {
      await uploaded?.rollback?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); this.saving = false;
    }
  }
}
