import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createReadStream, createWriteStream } from 'fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'fs/promises';
import { join, sep } from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { createHash } from 'crypto';
import { CookedEditorRuntime, PreparedCookedSource } from './cooked-editor-runtime';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX = 100 * 1024 * 1024;
type Receipt = Awaited<ReturnType<CookedEditorRuntime['revise']>>;
type Job = { org: string; media: string; request: string; at: number; status: 'working' | 'ready' | 'failed'; ingress?: string; receipt?: Receipt; nativeId?: string; state?: Record<string, any>; metadata?: PreparedCookedSource['metadata'] };
const error = (code: number) => Object.assign(new Error('Editor request failed'), { status: code });
function nativeFailure(event: string, error: unknown) {
  const message = (error as Error).message;
  const code = typeof message === 'string' && message.length <= 128 && /^[A-Za-z_]+(?::[A-Z_]+)*$/.test(message) ? message : 'UNKNOWN';
  // No transcripts, paths, source metadata or arbitrary native stderr.
  console.error(JSON.stringify({ event, code }));
}
async function json(req: IncomingMessage) {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; if (size > 16384) throw error(413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw error(400); }
}
function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(data);
}
async function ownedFile(job: Job, path: string) {
  const root = job.receipt!.workspace;
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw error(404);
  if (!path.startsWith(root + sep)) throw error(404);
  const parts = path.slice(root.length + 1).split(sep); let current = root;
  for (const part of parts) { if (!part || part === '..') throw error(404); current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw error(404); }
  if (await realpath(path) !== path || !(await lstat(path)).isFile()) throw error(404);
  return path;
}
async function media(req: IncomingMessage, res: ServerResponse, path: string) {
  const size = (await lstat(path)).size;
  const header = req.headers.range; let start = 0, end = size - 1;
  if (header) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(header);
    if (!match) throw error(416);
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw error(416);
  }
  res.writeHead(header ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
    'Cache-Control': 'no-store', ...(header ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  await pipeline(createReadStream(path, { start, end }), res);
}

/** Private Unix-socket worker. Tenant authentication belongs to the app gateway;
 * all worker job requests still bind organization, media and opaque job identity.
 * The container supplies the network/filesystem/cgroup boundary, not this server.
 */
export function createCookedWorker(runtime: CookedEditorRuntime, workRoot: string, sourceRoot: string) {
  const jobs = new Map<string, Job>(); let active = false, retiring = false;
  const receipt = (j: Job) => ({ requestId: j.request, jobId: j.receipt?.jobId, revision: j.receipt?.revision, status: j.status, editing: { mode: 'quiet-block-v1', wordCuts: false, arbitraryPhrases: false, pauseEdits: false, blocks: j.receipt?.blocks ?? [], removedBlocks: j.receipt?.removedBlocks ?? [] } });
  async function studioEvidence(j: Job) {
    const r = j.receipt!;
    const hash = async (file: string) => { const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex'); };
    const source = await ownedFile(j, join(r.workspace, 'source.mp4'));
    if (await hash(source) !== r.sourceSha256) throw error(409);
    const files: Record<string, any> = {};
    for (const [key, name] of Object.entries({ rawWords: 'words.raw.json', words: 'words.json', decisions: 'decisions.json', policy: 'boundary-policy.json', report: 'report.json' })) {
      const file = await ownedFile(j, join(r.editDirectory, name));
      if ((await lstat(file)).size > 1024 * 1024) throw error(413);
      let value = JSON.parse(await readFile(file, 'utf8'));
      if (key === 'report') value = { fps: value.fps, final_s: value.final_s, frames: value.frames, policy: value.policy };
      files[key] = { sha256: await hash(file), value };
    }
    const audio = await ownedFile(j, r.cutPath), bytes = (await lstat(audio)).size;
    if (bytes < 1 || bytes > MAX) throw error(413);
    return { value: { schemaVersion: 1, organizationId: j.org, mediaId: j.media, jobId: r.jobId, revision: r.revision,
      sourceSha256: r.sourceSha256, fps: files.policy.value.fps, totalFrames: files.policy.value.total,
      width: j.metadata?.width, height: j.metadata?.height, files, audio: { bytes, sha256: await hash(audio) } }, audio };
  }
  async function cleanup(j: Job) {
    if (j.status === 'working') return;
    if (server.listenerCount('sessionClosed')) retiring = true;
    j.status = 'failed';
    try {
      if (j.nativeId) { await runtime.cleanup(j.nativeId, j.org); j.nativeId = undefined; }
      if (j.ingress) await rm(j.ingress, { recursive: true });
      jobs.delete(j.org + ':' + j.request);
    } finally {
      // An I/O cleanup failure must still destroy the old tenant's namespace.
      if (retiring) server.emit('sessionClosed');
    }
  }
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    try {
      if (retiring) throw error(503);
      const url = new URL(req.url!, 'http://worker');
      if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { schemaVersion: 1, ready: true });
      const org = req.headers['x-cooked-org'], id = req.headers['x-cooked-media'];
      if (typeof org !== 'string' || typeof id !== 'string' || !/^[\w-]{1,128}$/.test(org) || !/^[\w-]{1,128}$/.test(id)) throw error(403);
      if (url.pathname === '/find' && ['GET', 'DELETE'].includes(req.method || '')) {
        const key = url.searchParams.get('request'); if (!key || !UUID.test(key)) throw error(400);
        const j = jobs.get(org + ':' + key); if (!j || j.media !== id) throw error(404);
        if (req.method === 'DELETE') { if (active) throw error(429); await cleanup(j); return send(res, 200, {}); }
        j.at = Date.now(); return send(res, 200, receipt(j));
      }
      if (url.pathname === '/jobs' && req.method === 'POST') {
        const request = req.headers['x-cooked-request'];
        if (typeof request !== 'string' || !UUID.test(request)) throw error(400);
        const existing = jobs.get(org + ':' + request);
        if (existing) { if (existing.media !== id) throw error(409); req.resume(); return send(res, 200, receipt(existing)); }
        // One retained review session globally: no second tenant's files coexist.
        if (active || jobs.size >= 1) throw error(429);
        const length = Number(req.headers['content-length']); if (!Number.isSafeInteger(length) || length <= 0 || length > MAX) throw error(413);
        let metadata: PreparedCookedSource['metadata'];
        try { metadata = JSON.parse(Buffer.from(String(req.headers['x-cooked-metadata']), 'base64').toString()); } catch { throw error(400); }
        const j: Job = { org, media: id, request, at: Date.now(), status: 'working', metadata }; jobs.set(org + ':' + request, j); active = true;
        try {
          j.ingress = await mkdtemp(join(workRoot, 'ingress-')); await chmod(j.ingress, 0o700);
          const path = join(j.ingress, 'source.mp4'); let size = 0;
          const count = new Transform({ transform(chunk, _, done) { size += chunk.length; done(size > length || size > MAX ? error(413) : null, chunk); } });
          await pipeline(req, count, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
          if (size !== length) throw error(400);
          j.receipt = await runtime.run({ orgId: org, mediaId: id, sourcePath: path, metadata }); j.nativeId = j.receipt.jobId;
          j.state = JSON.parse(await readFile(await ownedFile(j, join(j.receipt.editDirectory, 'review.json')), 'utf8'));
          j.status = 'ready';
        } catch (e) {
          nativeFailure('cooked_native_failed', e);
          const jobId = (e as { jobId?: string }).jobId;
          if (jobId) { j.nativeId = jobId; await runtime.cleanup(jobId, org).then(() => { j.nativeId = undefined; }).catch(() => {}); }
          j.status = 'failed'; throw error(422);
        } finally { active = false; j.at = Date.now(); }
        return send(res, 200, receipt(j));
      }
      const match = /^\/jobs\/([0-9a-f-]{36})(?:\/(state|data|video|download|review|edits|studio-evidence|studio-audio))?$/.exec(url.pathname);
      if (!match || !UUID.test(match[1])) throw error(404);
      const j = [...jobs.values()].find(j => j.org === org && j.media === id && j.receipt?.jobId === match[1]);
      if (!j || j.status !== 'ready') throw error(404); j.at = Date.now();
      const r = j.receipt!, edit = r.editDirectory, action = match[2];
      if (!action && req.method === 'DELETE') { if (active) throw error(429); await cleanup(j); return send(res, 200, {}); }
      if (action === 'edits' && req.method === 'POST') {
        if (active) throw error(429); const body = await json(req);
        if (!body || Object.keys(body).some(k => !['revision', 'cut', 'restore', 'pause'].includes(k))) throw error(400);
        if (!Number.isSafeInteger(body.revision) || body.revision !== r.revision) throw error(409);
        const { revision, ...edits } = body; active = true; let completed = false;
        try {
          const next = await runtime.revise(r.jobId, org, edits, revision); completed = true;
          const state = JSON.parse(await readFile(await ownedFile(j, join(next.editDirectory, 'review.json')), 'utf8'));
          // Publish receipt + native snapshot together, never a half-written round.
          j.receipt = next; j.state = state;
        }
        catch (e) {
          nativeFailure('cooked_native_revision_failed', e);
          // Only the trusted runtime can attest that the complete previous draft
          // was restored. Keep its receipt/state; the rejected edit still gets422.
          const restored = (e as { previousRevisionRestored?: boolean }).previousRevisionRestored === true;
          if (completed || ((e as { jobId?: string }).jobId && !restored)) j.status = 'failed';
          throw error(422);
        }
        finally { active = false; }
        return send(res, 200, { event: true, revision: j.receipt!.revision });
      }
      if (req.method !== 'GET') throw error(405);
      if (action === 'studio-evidence' || action === 'studio-audio') {
        if (active || url.searchParams.get('revision') !== String(r.revision)) throw error(409);
        active = true;
        try {
          const snapshot = await studioEvidence(j);
          if (action === 'studio-evidence') return send(res, 200, snapshot.value);
          if (url.searchParams.get('sha256') !== snapshot.value.audio.sha256) throw error(409);
          return await media(req, res, snapshot.audio);
        } finally { active = false; }
      }
      const state = j.state!; // last completed native round, including during a mutation
      const k = url.searchParams.get('k');
      const round = k ? state.rounds.find((x: { stage: string; round: number }) => `${x.stage}-${x.round}` === k) : state;
      if (action === 'state') {
        const clean = (x: Record<string, unknown>) => Object.fromEntries(Object.entries(x).filter(([key]) => ['stage', 'round', 'at', 'vertical', 'stills', 'final', 'name', 'label'].includes(key)));
        return send(res, 200, { ...clean(state), revision: r.revision, comments: [], events: [], alts: [], sent: false, raw: false, rawvideo: true,
          rounds: state.rounds.map((x: Record<string, unknown>) => ({ ...clean(x), video: 'available', alts: [] })), listening: true,
          busy: active, page: 'cooked-app-v1', intro: false, home: null, jobs: 0, assets: [], skills: [], made: null });
      }
      if (action === 'review') return send(res, 200, await readFile(join(sourceRoot, 'plugins/ai-editor/lib/ai_editor/review.html')), 'text/html; charset=utf-8');
      if (action === 'data') {
        if (!round || !/^cut-[1-9]\d{0,3}$/.test(k || '')) throw error(404);
        const path = await ownedFile(j, join(edit, 'review', `data-cut${round.round}.json`));
        if ((await lstat(path)).size > 8 * 1024 * 1024) throw error(413);
        return send(res, 200, await readFile(path));
      }
      if (action === 'video' || action === 'download') {
        if (action === 'download' && active) throw error(409);
        if (k === 'raw') return await media(req, res, await ownedFile(j, join(r.workspace, 'source.mp4')));
        if (!round) throw error(404);
        return await media(req, res, await ownedFile(j, round.video));
      }
      throw error(404);
    } catch (e) { if (!res.headersSent) send(res, (e as { status?: number }).status || 500, { error: 'The editor request could not be completed. Your original is unchanged.' }); else res.destroy(); }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 5_000;
  const timer = setInterval(() => { if (!active) for (const j of jobs.values()) if (Date.now() - j.at > 15 * 60_000) void cleanup(j).catch(() => {}); }, 60_000);
  timer.unref(); server.once('close', () => clearInterval(timer));
  return server;
}

export async function listenCookedWorker(runtime: CookedEditorRuntime, workRoot: string, sourceRoot: string, socket: string) {
  await mkdir(workRoot, { recursive: true, mode: 0o700 }); await chmod(workRoot, 0o700);
  // Refuse existing entries; the caller owns removal of an old socket after a stopped worker.
  const server = createCookedWorker(runtime, workRoot, sourceRoot);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  await chmod(socket, 0o660); return server;
}
