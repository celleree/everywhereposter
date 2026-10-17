import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { appendFileSync, constants, existsSync, statSync } from 'fs';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, relative } from 'path';

type PipelineStage = 'transcribe' | 'retakes' | 'build_timeline' | 'render' | 'verify';
type Stage = PipelineStage | 'apply_edits' | 'review_start' | 'review_round' | 'review_final';
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
  command?: Omit<CookedCommand, 'stage' | 'script' | 'args' | 'timeoutMs'>;
}
const MiB = 1024 * 1024;
const scripts: Record<PipelineStage, string> = { transcribe: 'transcribe.py', retakes: 'retakes.py', build_timeline: 'build_timeline.py', render: 'render.py', verify: 'verify_cut.py' };
const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
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
    if (entry.isSymbolicLink()) throw new Error('WORKSPACE_SYMLINK');
    total += entry.isDirectory() ? await bytes(p) : (await lstat(p)).size;
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
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
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
      try {
        if (await groupRss(child.pid) > command.rssBytes) fail('RSS_LIMIT');
        if (await bytes(command.workspace) > command.workspaceBytes) fail('WORKSPACE_LIMIT');
      } catch { fail('SUPERVISION_FAILED'); }
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
 * Paths in receipts are private and must only be read through a future org proxy.
 * Trusted config supplies a reviewed pinned upstream checkout and vetted tiny model.
 */
export class CookedEditorRuntime {
  private active = false;
  private jobs = new Map<string, OwnedJob>();
  private stageMs: number; private overallMs: number; private rss: number; private disk: number;
  constructor(private config: CookedConfig, private runner: CookedRunner = runCookedCommand) {
    this.stageMs = bounded(config.stageTimeoutMs, 90_000);
    this.overallMs = bounded(config.overallTimeoutMs, 240_000);
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
          m.durationMs > 60_000 || Math.max(m.width, m.height) > 1920 || Math.min(m.width, m.height) > 1080 || m.fps > 60) throw new Error('UNSUPPORTED_SOURCE');
      await regular(input.sourcePath);
      if ((await stat(input.sourcePath)).size > 100 * MiB) throw new Error('SOURCE_TOO_LARGE');
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
        durationSeconds: m.durationMs / 1000, revision: 0, ready: false, sourcePath: input.sourcePath };
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
      for (const stage of Object.keys(scripts) as PipelineStage[]) await this.execute(job, stage, join(native, scripts[stage]), args[stage], started);
      await this.review(job, 'start', started); await this.review(job, 'final', started);
      await regular(join(edit, 'cut.mp4'));
      if (await digest(source) !== job.sourceSha256 || await digest(input.sourcePath) !== job.sourceSha256) throw new Error('SOURCE_CHANGED');
      job.ready = true;
      return { jobId, revision: job.revision, sourceSha256: job.sourceSha256, workspace, editDirectory: edit, cutPath: join(edit, 'cut.mp4') };
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
    this.active = true; job.active = true;
    const started = Date.now(), source = join(job.workspace, 'source.mp4'), edit = join(job.workspace, 'edit');
    try {
      await this.assertOwned(job);
      if (await digest(source) !== job.sourceSha256 || await digest(job.sourcePath) !== job.sourceSha256) throw new Error('SOURCE_CHANGED');
      const helper = join(dirname(this.config.launcherPath), 'cooked-editor-apply.py'); await regular(helper);
      const request = join(job.workspace, 'revision-request.json');
      await writeFile(request, JSON.stringify(edits), { mode: 0o600 });
      // Native edits are not transactional with rendering. Failed mutations are cleanup-only.
      job.ready = false; job.revision++;
      await this.execute(job, 'apply_edits', helper, [this.config.sourceRoot, edit, request], started);
      for (const stage of ['build_timeline', 'render', 'verify'] as PipelineStage[]) {
        await this.execute(job, stage, join(this.config.sourceRoot, 'plugins/ai-editor/skills/cut/scripts', scripts[stage]),
          stage === 'verify' ? [edit, '--engine', 'whisper'] : [source, edit, ...(stage === 'render' ? ['--max', '1080'] : [])], started);
      }
      await this.review(job, 'round', started);
      await regular(join(edit, 'cut.mp4'));
      if (await digest(source) !== job.sourceSha256 || await digest(job.sourcePath) !== job.sourceSha256) throw new Error('SOURCE_CHANGED');
      job.ready = true;
      return { jobId, revision: job.revision, sourceSha256: job.sourceSha256, workspace: job.workspace, editDirectory: edit, cutPath: join(edit, 'cut.mp4') };
    } catch (error) { throw Object.assign(error as Error, { jobId, revision: job.revision }); }
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
