import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { CookedCommand, CookedConfig, CookedEditorRuntime, PreparedCookedSource, runCookedCommand } from '../../libraries/nestjs-libraries/src/media-editing/cooked-editor-runtime';

describe('private cooked native boundary', () => {
  let root: string, config: CookedConfig, input: PreparedCookedSource, calls: CookedCommand[];
  const runner = async (c: CookedCommand) => {
    calls.push(c);
    if (c.stage === 'render') {
      await writeFile(join(c.workspace, 'edit/cut.mp4'), 'native cut');
      await writeFile(join(c.workspace, 'edit/cut.transcript.json'), 'stale cache');
    }
    if (c.stage === 'verify') expect(await readdir(join(c.workspace, 'edit'))).not.toContain('cut.transcript.json');
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cooked-boundary-test-')); calls = [];
    const native = join(root, 'upstream/plugins/ai-editor/skills/cut/scripts');
    await mkdir(native, { recursive: true });
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
    expect(calls.map(c => c.stage)).toEqual(['transcribe', 'retakes', 'build_timeline', 'render', 'verify']);
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
});
