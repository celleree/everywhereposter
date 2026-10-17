import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { appendFileSync, constants, createReadStream, existsSync, statSync } from 'fs';
import { cp, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, rmdir, stat, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, relative } from 'path';
import { PACING_SETTINGS } from './video-edit-decision';
import { COOKED_EDITOR_LIMITS as LIMITS } from './cooked-editor-limits';

type PipelineStage = 'transcribe' | 'retakes' | 'build_timeline' | 'render' | 'verify';
type Stage = PipelineStage | 'apply_edits' | 'prepare_boundaries' | 'audit_render' | 'review_start' | 'review_round' | 'review_final';
export interface CookedCommand {
  stage: Stage; python: string; launcher: string; script: string; args: string[];
  workspace: string; env: NodeJS.ProcessEnv; timeoutMs: number; rssBytes: number; workspaceBytes: number;
}
export type CookedRunner = (command: CookedCommand) => Promise<void>;
export interface CookedConfig {
  sourceRoot: string; python: string; modelPath: string; workRoot: string; launcherPath: string;
  path: string; stageTimeoutMs?: number; overallTimeoutMs?: number; rssBytes?: number; workspaceBytes?: number;
}
export interface PreparedCookedSource {
  // Server-only context. The caller must probe this exact prepared source and verify
  // audio/video/format timestamps are known and aligned before invoking this adapter.
  orgId: string; mediaId: string; sourcePath: string;
  metadata: { durationMs: number; width: number; height: number; fps: number; alignedTimestamps: true; hasAudio: true };
}
export interface CookedEdits { cut?: [number, number][]; restore?: [number, number][]; pause?: [number, number][] }
interface OwnedJob {
  workspace: string; marker: string; orgId: string; sourceSha256: string; active: boolean;
  durationSeconds: number; revision: number; ready: boolean; sourcePath: string;
  blocks: [number, number][]; selected: [number, number][];
  command?: Omit<CookedCommand, 'stage' | 'script' | 'args' | 'timeoutMs'>;
}
const MiB = 1024 * 1024;
const scripts: Record<PipelineStage, string> = { transcribe: 'transcribe.py', retakes: 'retakes.py', build_timeline: 'build_timeline.py', render: 'render.py', verify: 'verify_cut.py' };
const digest = async (path: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const bounded = (value: number | undefined, ceiling: number) => {
  const n = value ?? ceiling;
  if (!Number.isSafeInteger(n) || n <= 0 || n > ceiling) throw new Error('INVALID_LIMIT');
  return n;
};
async function regular(path: string) {
  if (!isAbsolute(path) || !(await lstat(path)).isFile()) throw new Error('REGULAR_ABSOLUTE_FILE_REQUIRED');
}
async function bytes(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const p = join(path, entry.name);
    try {
      const info = await lstat(p);
      if (info.isSymbolicLink()) throw new Error('WORKSPACE_SYMLINK');
      total += info.isDirectory() ? await bytes(p) : info.size;
    } catch (error) {
      // Native renderers remove temporary entries between enumeration and inspection.
      // Only disappearance of an enumerated child is benign; root/read/permission errors fail.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return total;
}
async function groupRss(group: number) {
  let total = 0;
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const fields = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1)!.split(' ');
      if (Number(fields[2]) === group) {
        const status = await readFile(`/proc/${pid}/status`, 'utf8');
        const rss = status.match(/^VmRSS:\s+(\d+) kB$/m);
        if (rss) total += Number(rss[1]) * 1024;
      }
    } catch (error) {
      // /proc can report ESRCH after an enumerated process exits, including
      // between opening its stat/status files. Permission and other errors fail.
      if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
    }
  }
  return total;
}

/** Linux-only supervisor; injected runners are for trusted tests, never request input.
 * RSS/disk caps are sampled every 100ms (possible brief overshoot); this is not a
 * kernel sandbox. Deploy only inside an independently bounded, offline worker.
 */
export const runCookedCommand: CookedRunner = async (command) => {
  if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED');
  await readdir('/proc'); // fail closed before spawning on unsupported hosts
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.python, ['-I', command.launcher, command.script, ...command.args], {
      cwd: command.workspace, env: command.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logPath = join(command.workspace, 'native.log');
    let failure: Error | undefined, logged = existsSync(logPath) ? statSync(logPath).size : 0, inspecting = false;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= e as Error; } } };
    const fail = (reason: string) => { failure ??= new Error(reason); kill(); };
    const log = (data: Buffer) => {
      logged += data.length;
      if (logged > 8 * MiB) return fail('LOG_LIMIT');
      try { appendFileSync(logPath, data, { mode: 0o600 }); } catch { fail('LOG_WRITE_FAILED'); }
    };
    child.stdout!.on('data', log); child.stderr!.on('data', log);
    const timer = setTimeout(() => fail('STAGE_TIMEOUT'), command.timeoutMs);
    const watch = setInterval(async () => {
      if (inspecting || !child.pid) return;
      inspecting = true;
      let check = 'RSS';
      try {
        if (await groupRss(child.pid) > command.rssBytes) fail('RSS_LIMIT');
        check = 'WORKSPACE';
        if (await bytes(command.workspace) > command.workspaceBytes) fail('WORKSPACE_LIMIT');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
        fail(`SUPERVISION_FAILED:${check}:${typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'UNKNOWN'}`);
      }
      finally { inspecting = false; }
    }, 100);
    child.once('error', (error) => { failure ??= error; });
    child.once('close', (code) => {
      clearTimeout(timer); clearInterval(watch); kill();
      if (failure || code !== 0) reject(failure ?? new Error(`NATIVE_${command.stage}_FAILED`)); else resolve();
    });
  });
};

/** Internal, non-durable adapter. No API route, authorization, queue, or downloads.
 * Paths in receipts are private and must only be read through the organization gateway.
 * Trusted config supplies a reviewed pinned upstream checkout and vetted tiny model.
 */
export class CookedEditorRuntime {
  private active = false;
  private jobs = new Map<string, OwnedJob>();
  private stageMs: number; private overallMs: number; private rss: number; private disk: number;
  constructor(private config: CookedConfig, private runner: CookedRunner = runCookedCommand) {
    this.stageMs = bounded(config.stageTimeoutMs, LIMITS.stageTimeoutMs);
    this.overallMs = bounded(config.overallTimeoutMs, LIMITS.operationTimeoutMs);
    this.rss = bounded(config.rssBytes, 768 * MiB);
    this.disk = bounded(config.workspaceBytes, 512 * MiB);
  }
  async run(input: PreparedCookedSource) {
    if (this.active) throw new Error('BUSY');
    this.active = true;
    const started = Date.now(), jobId = randomUUID();
    let job: OwnedJob | undefined;
    try {
      const m = input.metadata;
      if (!input.orgId || !input.mediaId || !m || !m.alignedTimestamps || !m.hasAudio ||
          ![m.durationMs, m.width, m.height, m.fps].every(n => Number.isFinite(n) && n > 0) ||
          m.durationMs > LIMITS.maxDurationMs || Math.max(m.width, m.height) > LIMITS.maxLongEdge || Math.min(m.width, m.height) > LIMITS.maxShortEdge || m.fps > LIMITS.maxFps) throw new Error('UNSUPPORTED_SOURCE');
      await regular(input.sourcePath);
      if ((await stat(input.sourcePath)).size > LIMITS.maxBytes) throw new Error('SOURCE_TOO_LARGE');
      for (const p of [this.config.workRoot, this.config.sourceRoot, this.config.modelPath]) {
        if (!isAbsolute(p) || !(await lstat(p)).isDirectory()) throw new Error('ABSOLUTE_DIRECTORY_REQUIRED');
      }
      const root = await realpath(this.config.workRoot);
      if (((await stat(root)).mode & 0o077) !== 0) throw new Error('PRIVATE_WORK_ROOT_REQUIRED');
      await regular(await realpath(this.config.python)); await regular(this.config.launcherPath);
      const native = join(await realpath(this.config.sourceRoot), 'plugins/ai-editor/skills/cut/scripts');
      for (const script of Object.values(scripts)) await regular(join(native, script));
      const sourceSha256 = await digest(input.sourcePath);
      const workspace = await mkdtemp(join(root, 'cooked-'));
      job = { workspace, orgId: input.orgId, sourceSha256, active: true, marker: '',
        durationSeconds: m.durationMs / 1000, revision: 0, ready: false, sourcePath: input.sourcePath, blocks: [], selected: [] };
      job.marker = JSON.stringify({ jobId, orgId: input.orgId, mediaId: input.mediaId, sourceSha256: job.sourceSha256 });
      this.jobs.set(jobId, job);
      await writeFile(join(workspace, '.cooked-owner'), job.marker, { flag: 'wx', mode: 0o600 });
      const source = join(workspace, 'source.mp4'), edit = join(workspace, 'edit');
      await copyFile(input.sourcePath, source, constants.COPYFILE_EXCL);
      if (await digest(source) !== job.sourceSha256) throw new Error('SOURCE_CHANGED');
      for (const dir of ['home', 'tmp', 'library', 'edit']) await mkdir(join(workspace, dir), { mode: 0o700 });
      const env = { PATH: this.config.path, HOME: join(workspace, 'home'), AI_EDITOR_HOME: join(workspace, 'home'),
        AI_EDITOR_LIBRARY: join(workspace, 'library'), TMPDIR: join(workspace, 'tmp'),
        AI_EDITOR_WHISPER_MODEL: await realpath(this.config.modelPath), HF_HUB_OFFLINE: '1', HF_DATASETS_OFFLINE: '1',
        OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' };
      const args: Record<PipelineStage, string[]> = {
        transcribe: [source, join(edit, 'words.raw.json'), '--engine', 'whisper', '--lang', 'en'],
        retakes: ['propose', edit], build_timeline: [source, edit], render: [source, edit, '--max', '1080'],
        verify: [edit, '--engine', 'whisper'],
      };
      job.command = { python: this.config.python, launcher: this.config.launcherPath, workspace, env,
        rssBytes: this.rss, workspaceBytes: this.disk };
      const helper = join(dirname(this.config.launcherPath), 'cooked-quiet-blocks.py'); await regular(helper);
      await this.execute(job, 'prepare_boundaries', helper, ['prepare', this.config.sourceRoot, source, edit, JSON.stringify(PACING_SETTINGS.relaxed)], started);
      const policy = JSON.parse(await readFile(join(edit, 'boundary-policy.json'), 'utf8'));
      if (policy.version !== 'quiet-block-v1' || policy.sourceSha256 !== job.sourceSha256 || !Array.isArray(policy.blocks) ||
          policy.blocks.length > 100 || policy.blocks.some((r: unknown) => !Array.isArray(r) || r.length !== 2 ||
            r.some(n => typeof n !== 'number' || !Number.isFinite(n)) || r[0] < 0 || r[0] >= r[1] || r[1] > job!.durationSeconds)) throw new Error('INVALID_BOUNDARY_POLICY');
      job.blocks = policy.blocks;
      for (const stage of ['transcribe', 'build_timeline', 'render', 'audit_render', 'verify'] as const) {
        await this.execute(job, stage, stage === 'build_timeline' || stage === 'audit_render' ? helper : join(native, scripts[stage]),
          stage === 'build_timeline' || stage === 'audit_render' ? [stage === 'build_timeline' ? 'build' : 'audit', this.config.sourceRoot, source, edit] : args[stage], started);
      }
      await this.review(job, 'start', started); await this.review(job, 'final', started);
      await regular(join(edit, 'cut.mp4'));
      if (await digest(source) !== job.sourceSha256 || await digest(input.sourcePath) !== job.sourceSha256) throw new Error('SOURCE_CHANGED');
      job.ready = true;
      return { jobId, revision: job.revision, sourceSha256: job.sourceSha256, workspace, editDirectory: edit, cutPath: join(edit, 'cut.mp4'), blocks: job.blocks, removedBlocks: job.selected };
    } catch (error) { throw Object.assign(error as Error, { jobId: job ? jobId : undefined }); }
    finally { if (job) job.active = false; this.active = false; }
  }
  private async execute(job: OwnedJob, stage: Stage, script: string, args: string[], started: number) {
    // Native render-cache mtimes can make an old verification transcript appear fresh.
    if (stage === 'verify') await rm(join(job.workspace, 'edit/cut.transcript.json'), { force: true });
    const remaining = this.overallMs - (Date.now() - started);
    if (remaining <= 0) throw new Error('OVERALL_TIMEOUT');
    if (await bytes(job.workspace) > this.disk) throw new Error('WORKSPACE_LIMIT');
    await this.runner({ ...job.command!, stage, script, args, timeoutMs: Math.min(this.stageMs, remaining) });
    if (Date.now() - started >= this.overallMs) throw new Error('OVERALL_TIMEOUT');
    if (await bytes(job.workspace) > this.disk) throw new Error('WORKSPACE_LIMIT');
  }
  private async review(job: OwnedJob, action: 'start' | 'round' | 'final', started: number) {
    const edit = join(job.workspace, 'edit');
    const script = join(this.config.sourceRoot, 'plugins/ai-editor/lib/ai_editor/review.py');
    await regular(script);
    await this.execute(job, `review_${action}`, script, [edit, action, ...(action === 'final' ? [] :
      ['--video', join(edit, 'cut.mp4'), '--stage', 'cut', '--transcript', join(edit, 'words.json')])], started);
  }
  private async assertOwned(job: OwnedJob) {
    const root = await realpath(this.config.workRoot), path = await realpath(job.workspace);
    if (relative(root, path).startsWith('..') || relative(root, path) === '' || path !== job.workspace ||
        await readFile(join(path, '.cooked-owner'), 'utf8') !== job.marker) throw new Error('OWNERSHIP_MISMATCH');
  }
  async revise(jobId: string, orgId: string, edits: CookedEdits, expectedRevision: number) {
    if (this.active) throw new Error('BUSY');
    const job = this.jobs.get(jobId);
    if (!job || job.orgId !== orgId || job.active) throw new Error('NOT_OWNED_OR_ACTIVE');
    if (!job.ready || !Number.isSafeInteger(expectedRevision) || expectedRevision !== job.revision) throw new Error('STALE_OR_FAILED_REVISION');
    if (!edits || Object.keys(edits).some(key => !['cut', 'restore', 'pause'].includes(key))) throw new Error('INVALID_EDITS');
    const ranges = ['cut', 'restore', 'pause'].flatMap(key => {
      const list = edits[key as keyof CookedEdits] ?? [];
      if (!Array.isArray(list)) throw new Error('INVALID_EDITS');
      return list;
    });
    if (ranges.length === 0 || ranges.length > 100 || ranges.some(r => !Array.isArray(r) || r.length !== 2 ||
        r.some(n => typeof n !== 'number' || !Number.isFinite(n)) || r[0] < 0 || r[0] >= r[1] || r[1] > job.durationSeconds)) throw new Error('INVALID_EDITS');
    const same = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];
    const cut = edits.cut ?? [], restore = edits.restore ?? [];
    if (edits.pause?.length || cut.some(r => !job.blocks.some(b => same(r, b)) || job.selected.some(b => same(r, b))) ||
        restore.some(r => !job.selected.some(b => same(r, b))) || new Set([...cut, ...restore].map(r => JSON.stringify(r))).size !== cut.length + restore.length) throw new Error('UNSUPPORTED_BLOCK_EDIT');
    const nextSelected = [...job.selected.filter(r => !restore.some(b => same(r, b))), ...cut.map(r => [...r] as [number, number])].sort((a, b) => a[0] - b[0]);
    this.active = true; job.active = true;
    const started = Date.now(), source = join(job.workspace, 'source.mp4'), edit = join(job.workspace, 'edit');
    let checkpoint: string | undefined, previousRender = '', previousReview = '';
    try {
      await this.assertOwned(job);
      if (await digest(source) !== job.sourceSha256 || await digest(job.sourcePath) !== job.sourceSha256) throw new Error('SOURCE_CHANGED');
      const helper = join(dirname(this.config.launcherPath), 'cooked-quiet-blocks.py'); await regular(helper);
      const request = join(job.workspace, 'revision-request.json');
      await writeFile(request, JSON.stringify(edits), { mode: 0o600 });
      // Preserve the verified native draft before a speculative edit. Cache segments
      // can be regenerated; every checkpoint byte still counts toward the job cap.
      previousRender = await digest(join(edit, 'cut.mp4'));
      previousReview = await digest(join(edit, 'review.json'));
      if (await bytes(job.workspace) + await bytes(edit) + 8 * MiB > this.disk) throw new Error('CHECKPOINT_LIMIT');
      checkpoint = await mkdtemp(join(job.workspace, 'verified-edit-'));
      await rmdir(checkpoint); // cp requires an absent exclusive destination
      await cp(edit, checkpoint, { recursive: true, force: false, errorOnExist: true, filter: async path => {
        if (relative(edit, path).split('/')[0] === '.segments') return false;
        const info = await lstat(path);
        if (!info.isDirectory() && !info.isFile()) throw new Error('CHECKPOINT_FILE_REQUIRED');
        return true;
      } });
      job.ready = false; job.revision++;
      await this.execute(job, 'apply_edits', helper, ['apply', this.config.sourceRoot, source, edit, request], started);
      for (const stage of ['build_timeline', 'render', 'audit_render', 'verify'] as const) {
        await this.execute(job, stage, stage === 'build_timeline' || stage === 'audit_render' ? helper : join(this.config.sourceRoot, 'plugins/ai-editor/skills/cut/scripts', scripts[stage]),
          stage === 'build_timeline' || stage === 'audit_render' ? [stage === 'build_timeline' ? 'build' : 'audit', this.config.sourceRoot, source, edit] :
            stage === 'verify' ? [edit, '--engine', 'whisper'] : [source, edit, '--max', '1080'], started);
      }
      await this.review(job, 'round', started);
      await regular(join(edit, 'cut.mp4'));
      if (await digest(source) !== job.sourceSha256 || await digest(job.sourcePath) !== job.sourceSha256) throw new Error('SOURCE_CHANGED');
      await rm(checkpoint, { recursive: true }); checkpoint = undefined;
      job.ready = true; job.selected = nextSelected;
      return { jobId, revision: job.revision, sourceSha256: job.sourceSha256, workspace: job.workspace, editDirectory: edit, cutPath: join(edit, 'cut.mp4'), blocks: job.blocks, removedBlocks: job.selected };
    } catch (error) {
      let previousRevisionRestored = false;
      if ((error as Error).message === 'NATIVE_verify_FAILED' && checkpoint && !job.ready) {
        try {
          await this.assertOwned(job);
          if (await digest(source) !== job.sourceSha256 || await digest(job.sourcePath) !== job.sourceSha256) throw new Error('SOURCE_CHANGED');
          // Guarded swap while the worker remains busy. Never serve the rejected
          // render as a successful revision, even when rollback itself fails.
          const rejected = join(job.workspace, 'rejected-edit');
          await rename(edit, rejected); await rename(checkpoint, edit); checkpoint = undefined;
          if (await digest(join(edit, 'cut.mp4')) !== previousRender || await digest(join(edit, 'review.json')) !== previousReview) throw new Error('RESTORE_MISMATCH');
          await rm(rejected, { recursive: true });
          if (await digest(source) !== job.sourceSha256 || await digest(job.sourcePath) !== job.sourceSha256 || await bytes(job.workspace) > this.disk) throw new Error('RESTORE_MISMATCH');
          job.revision = expectedRevision; job.ready = true; previousRevisionRestored = true;
        } catch { job.ready = false; }
      }
      throw Object.assign(error as Error, { jobId, revision: job.revision, previousRevisionRestored });
    }
    finally { job.active = false; this.active = false; }
  }
  async cleanup(jobId: string, orgId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.orgId !== orgId || job.active) throw new Error('NOT_OWNED_OR_ACTIVE');
    job.active = true;
    try {
      await this.assertOwned(job);
      await rm(job.workspace, { recursive: true }); this.jobs.delete(jobId);
      return { jobId, removed: true, sourceSha256: job.sourceSha256 };
    } finally { job.active = false; }
  }
}
