import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
const filesystem = require('fs/promises');
import { CookedCommand, CookedConfig, CookedEditorRuntime, PreparedCookedSource, runCookedCommand } from '../../libraries/nestjs-libraries/src/media-editing/cooked-editor-runtime';

describe('private cooked native boundary', () => {
  let root: string, config: CookedConfig, input: PreparedCookedSource, calls: CookedCommand[];
  const runner = async (c: CookedCommand) => {
    calls.push(c);
    if (c.stage === 'render') {
      await writeFile(join(c.workspace, 'edit/cut.mp4'), 'native cut');
      await writeFile(join(c.workspace, 'edit/cut.transcript.json'), 'stale cache');
    }
    if (c.stage === 'review_start') await writeFile(join(c.workspace, 'edit/review.json'), '{"round":1}');
    if (c.stage === 'verify') expect(await readdir(join(c.workspace, 'edit'))).not.toContain('cut.transcript.json');
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cooked-boundary-test-')); calls = [];
    const native = join(root, 'upstream/plugins/ai-editor/skills/cut/scripts');
    await mkdir(native, { recursive: true });
    await mkdir(join(root, 'upstream/plugins/ai-editor/lib/ai_editor'), { recursive: true });
    await writeFile(join(root, 'upstream/plugins/ai-editor/lib/ai_editor/review.py'), '');
    for (const file of ['transcribe', 'retakes', 'build_timeline', 'render', 'verify_cut']) await writeFile(join(native, `${file}.py`), '');
    for (const dir of ['model', 'jobs']) await mkdir(join(root, dir), { mode: 0o700 });
    const sourcePath = join(root, 'source.mp4'); await writeFile(sourcePath, 'original');
    config = { sourceRoot: join(root, 'upstream'), modelPath: join(root, 'model'), workRoot: join(root, 'jobs'),
      python: '/usr/bin/python3', launcherPath: join(__dirname, '../../libraries/nestjs-libraries/src/media-editing/cooked-editor-launcher.py'), path: '/usr/bin:/bin' };
    input = { orgId: 'o', mediaId: 'm', sourcePath, metadata: { durationMs: 10_000, width: 1920, height: 1080, fps: 30, hasAudio: true, alignedTimestamps: true } };
  });
  afterEach(async () => { delete process.env.COOKED_SECRET_TEST; await rm(root, { recursive: true, force: true }); });
  it('uses native commands, excludes secrets, preserves source and scopes cleanup', async () => {
    process.env.COOKED_SECRET_TEST = 'never pass';
    const runtime = new CookedEditorRuntime(config, runner), receipt = await runtime.run(input);
    expect(calls.map(c => c.stage)).toEqual(['transcribe', 'retakes', 'build_timeline', 'render', 'verify', 'review_start', 'review_final']);
    expect(calls[0].env).not.toHaveProperty('COOKED_SECRET_TEST');
    expect(calls[0].env.HOME).toBe(join(receipt.workspace, 'home'));
    expect(calls[0].env.HF_HUB_OFFLINE).toBe('1');
    expect(calls[0].args).toContain('whisper');
    expect(calls[0].rssBytes).toBe(768 * 1024 * 1024);
    expect(await readFile(receipt.cutPath, 'utf8')).toBe('native cut');
    await expect(runtime.cleanup(receipt.jobId, 'other')).rejects.toThrow('NOT_OWNED');
    await expect(runtime.cleanup('../../source.mp4', 'o')).rejects.toThrow('NOT_OWNED');
    expect(await runtime.cleanup(receipt.jobId, 'o')).toMatchObject({ removed: true });
    expect(await readFile(input.sourcePath, 'utf8')).toBe('original');
  });
  it('fails closed for unsupported metadata, missing files, symlinks, nonprivate roots and unsafe limits', async () => {
    const runtime = new CookedEditorRuntime(config, runner);
    for (const metadata of [{ ...input.metadata, fps: 61 }, { ...input.metadata, durationMs: 60001 }, { ...input.metadata, alignedTimestamps: false }]) {
      await expect(runtime.run({ ...input, metadata } as PreparedCookedSource)).rejects.toThrow('UNSUPPORTED_SOURCE');
    }
    await expect(runtime.run({ ...input, sourcePath: join(root, 'missing') })).rejects.toThrow();
    await expect(new CookedEditorRuntime({ ...config, sourceRoot: join(root, 'missing') }, runner).run(input)).rejects.toThrow();
    await symlink(input.sourcePath, join(root, 'link'));
    await expect(runtime.run({ ...input, sourcePath: join(root, 'link') })).rejects.toThrow('REGULAR');
    await chmod(config.workRoot, 0o755);
    await expect(runtime.run(input)).rejects.toThrow('PRIVATE');
    expect(() => new CookedEditorRuntime({ ...config, rssBytes: 769 * 1024 * 1024 })).toThrow('INVALID_LIMIT');
    expect(calls).toHaveLength(0);
  });
  it('rejects concurrent runs and protects active jobs', async () => {
    let release!: () => void;
    let entered!: (workspace: string) => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const entry = new Promise<string>(resolve => { entered = resolve; });
    const runtime = new CookedEditorRuntime(config, async c => { entered(c.workspace); await pending; await runner(c); });
    const first = runtime.run(input);
    await expect(runtime.run(input)).rejects.toThrow('BUSY');
    const workspace = await entry, marker = JSON.parse(await readFile(join(workspace, '.cooked-owner'), 'utf8'));
    await expect(runtime.cleanup(marker.jobId, 'o')).rejects.toThrow('NOT_OWNED_OR_ACTIVE'); release();
    await runtime.cleanup((await first).jobId, 'o');
  });
  it('rejects marker tampering and workspace escape before deletion', async () => {
    const runtime = new CookedEditorRuntime(config, runner), receipt = await runtime.run(input);
    const marker = await readFile(join(receipt.workspace, '.cooked-owner'), 'utf8');
    await writeFile(join(receipt.workspace, '.cooked-owner'), '{}');
    await expect(runtime.cleanup(receipt.jobId, 'o')).rejects.toThrow('OWNERSHIP_MISMATCH');
    await writeFile(join(receipt.workspace, '.cooked-owner'), marker);
    await rename(receipt.workspace, join(root, 'escaped'));
    await symlink(join(root, 'escaped'), receipt.workspace);
    await expect(runtime.cleanup(receipt.jobId, 'o')).rejects.toThrow('OWNERSHIP_MISMATCH');
    expect(await readFile(input.sourcePath, 'utf8')).toBe('original');
  });
  it('retains an owned cleanup receipt on native failure or disk limit', async () => {
    const runtime = new CookedEditorRuntime(config, async () => { throw new Error('native failed'); });
    const failure = await runtime.run(input).catch(e => e);
    expect(failure.message).toBe('native failed'); expect(failure.jobId).toBeDefined();
    await runtime.cleanup(failure.jobId, 'o');
    await expect(new CookedEditorRuntime({ ...config, workspaceBytes: 1 }, runner).run(input)).rejects.toThrow('WORKSPACE_LIMIT');
    const slow = new CookedEditorRuntime({ ...config, overallTimeoutMs: 10 }, async c => {
      await new Promise(resolve => setTimeout(resolve, 15)); await runner(c);
    });
    await expect(slow.run(input)).rejects.toThrow('OVERALL_TIMEOUT');
  });
  it('reuses native apply/render/review order for cut and restore with stale-cache invalidation', async () => {
    const runtime = new CookedEditorRuntime(config, runner), initial = await runtime.run(input);
    expect(initial.revision).toBe(0); calls = [];
    const cut = await runtime.revise(initial.jobId, 'o', { cut: [[1, 2]] }, 0);
    expect(cut.revision).toBe(1);
    expect(calls.map(c => c.stage)).toEqual(['apply_edits', 'build_timeline', 'render', 'verify', 'review_round']);
    expect(JSON.parse(await readFile(calls[0].args[2], 'utf8'))).toEqual({ cut: [[1, 2]] });
    expect(calls[0].script).toContain('cooked-editor-apply.py');
    const restored = await runtime.revise(initial.jobId, 'o', { restore: [[1, 2]], pause: [[3, 4]] }, 1);
    expect(restored.revision).toBe(2); expect(restored.jobId).toBe(initial.jobId);
    expect(await readFile(input.sourcePath, 'utf8')).toBe('original');
    await runtime.cleanup(initial.jobId, 'o');
  });
  it('refuses wrong org, stale revisions, invalid ranges and changed sources before native edits', async () => {
    const runtime = new CookedEditorRuntime(config, runner), initial = await runtime.run(input); calls = [];
    await expect(runtime.revise(initial.jobId, 'other', { cut: [[1, 2]] }, 0)).rejects.toThrow('NOT_OWNED');
    await expect(runtime.revise(initial.jobId, 'o', { cut: [[1, 2]] }, 1)).rejects.toThrow('STALE');
    for (const cut of [[[0, 11]], [[-1, 2]], [[2, 1]], [[1, 1]], [[NaN, 2]], [[1, Infinity]], [[1]], Array(101).fill([1, 2])]) {
      await expect(runtime.revise(initial.jobId, 'o', { cut } as any, 0)).rejects.toThrow('INVALID_EDITS');
    }
    await writeFile(input.sourcePath, 'changed');
    await expect(runtime.revise(initial.jobId, 'o', { cut: [[1, 2]] }, 0)).rejects.toThrow('SOURCE_CHANGED');
    expect(calls).toHaveLength(0);
  });
  it('serializes revisions with runs and makes a failed native mutation cleanup-only', async () => {
    let release!: () => void, entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const entry = new Promise<void>(resolve => { entered = resolve; });
    const runtime = new CookedEditorRuntime(config, async c => {
      if (c.stage === 'apply_edits') { entered(); await pending; throw new Error('native edit failed'); }
      await runner(c);
    });
    const initial = await runtime.run(input), revise = runtime.revise(initial.jobId, 'o', { cut: [[1, 2]] }, 0);
    await entry;
    await expect(runtime.run(input)).rejects.toThrow('BUSY');
    await expect(runtime.revise(initial.jobId, 'o', { cut: [[1, 2]] }, 0)).rejects.toThrow('BUSY');
    await expect(runtime.cleanup(initial.jobId, 'o')).rejects.toThrow('ACTIVE'); release();
    await expect(revise).rejects.toMatchObject({ message: 'native edit failed', revision: 1, jobId: initial.jobId });
    await expect(runtime.revise(initial.jobId, 'o', { restore: [[1, 2]] }, 1)).rejects.toThrow('STALE_OR_FAILED');
    await runtime.cleanup(initial.jobId, 'o');
  });
  it('rejects an unverified edit but restores the exact native draft and revision for a deliberate new choice', async () => {
    let reject = false;
    const runtime = new CookedEditorRuntime(config, async c => {
      await runner(c);
      if (reject && c.stage === 'render') {
        await writeFile(join(c.workspace, 'edit/cut.mp4'), 'rejected partial word');
        await writeFile(join(c.workspace, 'edit/decisions.json'), 'rejected decisions');
      }
      if (reject && c.stage === 'verify') throw new Error('NATIVE_verify_FAILED');
    });
    const initial = await runtime.run(input); reject = true;
    const failure = await runtime.revise(initial.jobId, 'o', { cut: [[1.48, 1.62]] }, 0).catch(e => e);
    expect(failure).toMatchObject({ message: 'NATIVE_verify_FAILED', revision: 0, previousRevisionRestored: true });
    expect(await readFile(initial.cutPath, 'utf8')).toBe('native cut');
    expect(await readFile(join(initial.editDirectory, 'review.json'), 'utf8')).toBe('{"round":1}');
    expect(await readdir(initial.editDirectory)).not.toContain('decisions.json');
    expect((await readdir(initial.workspace)).some(name => name.startsWith('verified-edit-') || name === 'rejected-edit')).toBe(false);
    reject = false;
    const next = await runtime.revise(initial.jobId, 'o', { cut: [[1.48, 2.08]] }, 0);
    expect(next.revision).toBe(1);
    expect((await runtime.revise(initial.jobId, 'o', { restore: [[1.48, 2.08]] }, 1)).revision).toBe(2);
    expect(await readFile(input.sourcePath, 'utf8')).toBe('original');
    await runtime.cleanup(initial.jobId, 'o');
  });
  it('never reports recovery when checkpoint restoration fails', async () => {
    let reject = false;
    const runtime = new CookedEditorRuntime(config, async c => {
      await runner(c);
      if (reject && c.stage === 'verify') throw new Error('NATIVE_verify_FAILED');
    });
    const initial = await runtime.run(input); reject = true;
    const originalRename = filesystem.rename;
    const swap = jest.spyOn(filesystem, 'rename').mockImplementation((async (from: string, to: string) => {
      if (from.includes('/verified-edit-')) throw new Error('simulated restore I/O failure');
      return originalRename(from, to);
    }) as any);
    try {
      await expect(runtime.revise(initial.jobId, 'o', { cut: [[1.48, 1.62]] }, 0)).rejects.toMatchObject({ previousRevisionRestored: false });
      await expect(runtime.revise(initial.jobId, 'o', { cut: [[1.48, 2.08]] }, 1)).rejects.toThrow('STALE_OR_FAILED');
    } finally { swap.mockRestore(); }
    await runtime.cleanup(initial.jobId, 'o');
  });
  it('does not recover over a changed source or a corrupted verified checkpoint', async () => {
    for (const sabotage of ['source', 'checkpoint']) {
      await writeFile(input.sourcePath, 'original'); let reject = false;
      const runtime = new CookedEditorRuntime(config, async c => {
        await runner(c);
        if (reject && c.stage === 'verify') {
          if (sabotage === 'source') await writeFile(input.sourcePath, 'external change');
          else {
            const name = (await readdir(c.workspace)).find(n => n.startsWith('verified-edit-'))!;
            await writeFile(join(c.workspace, name, 'review.json'), 'corrupted checkpoint');
          }
          throw new Error('NATIVE_verify_FAILED');
        }
      });
      const initial = await runtime.run(input); reject = true;
      await expect(runtime.revise(initial.jobId, 'o', { cut: [[1.48, 1.62]] }, 0)).rejects.toMatchObject({ previousRevisionRestored: false });
      await expect(runtime.revise(initial.jobId, 'o', { cut: [[1.48, 2.08]] }, 1)).rejects.toThrow('STALE_OR_FAILED');
      await runtime.cleanup(initial.jobId, 'o');
    }
  });
  it('bounds checkpoint allocation before native mutation and rejects unsafe checkpoint files', async () => {
    const runtime = new CookedEditorRuntime({ ...config, workspaceBytes: 8 * 1024 * 1024 }, runner);
    const initial = await runtime.run(input); calls = [];
    await expect(runtime.revise(initial.jobId, 'o', { cut: [[1.48, 1.62]] }, 0)).rejects.toThrow('CHECKPOINT_LIMIT');
    expect(calls).toHaveLength(0); expect(await readFile(initial.cutPath, 'utf8')).toBe('native cut');
    await runtime.cleanup(initial.jobId, 'o');
    const other = new CookedEditorRuntime(config, runner), job = await other.run(input); calls = [];
    await symlink(input.sourcePath, join(job.editDirectory, 'unsafe-link'));
    await expect(other.revise(job.jobId, 'o', { cut: [[1.48, 1.62]] }, 0)).rejects.toThrow('WORKSPACE_SYMLINK');
    expect(calls).toHaveLength(0); await other.cleanup(job.jobId, 'o');
  });
  it('supervises real subprocess affinity, nonzero exit, timeout, log and RSS limits', async () => {
    const workspace = join(root, 'jobs'), script = join(root, 'synthetic.py');
    const command = { stage: 'verify' as const, python: config.python, launcher: config.launcherPath, script, args: [], workspace,
      env: { PATH: config.path }, timeoutMs: 2000, rssBytes: 768 * 1024 * 1024, workspaceBytes: 512 * 1024 * 1024 };
    await writeFile(script, 'import os\nassert len(os.sched_getaffinity(0)) <= 2\n'); await runCookedCommand(command);
    await writeFile(script, 'raise SystemExit(7)\n'); await expect(runCookedCommand(command)).rejects.toThrow('NATIVE_verify_FAILED');
    await writeFile(script, 'import time\ntime.sleep(30)\n'); await expect(runCookedCommand({ ...command, timeoutMs: 50 })).rejects.toThrow('STAGE_TIMEOUT');
    await expect(runCookedCommand({ ...command, rssBytes: 1 })).rejects.toThrow('RSS_LIMIT');
    await writeFile(script, 'print("x" * (9 * 1024 * 1024))\n'); await expect(runCookedCommand(command)).rejects.toThrow('LOG_LIMIT');
  });
  it('tolerates an exited proc entry reported as ESRCH while permission errors still fail closed', async () => {
    const workspace = join(root, 'jobs'), script = join(root, 'synthetic.py');
    await writeFile(script, 'import time\ntime.sleep(0.4)\n');
    const command = { stage: 'verify' as const, python: config.python, launcher: config.launcherPath, script, args: [], workspace,
      env: { PATH: config.path }, timeoutMs: 2000, rssBytes: 768 * 1024 * 1024, workspaceBytes: 512 * 1024 * 1024 };
    const original = filesystem.readFile; let inspected = false;
    const vanished = jest.spyOn(filesystem, 'readFile').mockImplementation((async (path: string, ...args: any[]) => {
      if (/^\/proc\/\d+\/stat$/.test(path) && !inspected) { inspected = true; throw Object.assign(new Error('process exited'), { code: 'ESRCH' }); }
      return (original as any)(path, ...args);
    }) as any);
    try { await runCookedCommand(command); expect(inspected).toBe(true); } finally { vanished.mockRestore(); }
    const denied = jest.spyOn(filesystem, 'readFile').mockImplementation((async (path: string, ...args: any[]) => {
      if (/^\/proc\/\d+\/stat$/.test(path)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return (original as any)(path, ...args);
    }) as any);
    try { await expect(runCookedCommand(command)).rejects.toThrow('SUPERVISION_FAILED:RSS:EACCES'); } finally { denied.mockRestore(); }
  });
  it('tolerates an enumerated temporary file disappearing while preserving other supervision failures', async () => {
    const workspace = join(root, 'jobs'), script = join(root, 'synthetic.py'), transient = join(workspace, 'transient');
    await writeFile(script, 'import time\ntime.sleep(0.4)\n'); await writeFile(transient, 'temporary');
    const command = { stage: 'verify' as const, python: config.python, launcher: config.launcherPath, script, args: [], workspace,
      env: { PATH: config.path }, timeoutMs: 2000, rssBytes: 768 * 1024 * 1024, workspaceBytes: 512 * 1024 * 1024 };
    const original = filesystem.lstat;
    let inspected = false;
    const spy = jest.spyOn(filesystem, 'lstat').mockImplementation((async (path: string, ...args: any[]) => {
      if (path === transient) { inspected = true; throw Object.assign(new Error('temporary file disappeared'), { code: 'ENOENT' }); }
      return (original as any)(path, ...args);
    }) as any);
    try { await runCookedCommand(command); expect(inspected).toBe(true); } finally { spy.mockRestore(); }
    const denied = jest.spyOn(filesystem, 'lstat').mockImplementation((async (path: string, ...args: any[]) => {
      if (path === transient) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return (original as any)(path, ...args);
    }) as any);
    try { await expect(runCookedCommand(command)).rejects.toThrow('SUPERVISION_FAILED:WORKSPACE:EACCES'); } finally { denied.mockRestore(); }
    await symlink(input.sourcePath, join(workspace, 'linked'));
    await expect(runCookedCommand(command)).rejects.toThrow('SUPERVISION_FAILED:WORKSPACE:WORKSPACE_SYMLINK');
  });
});
