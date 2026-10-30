import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
const filesystem = require('fs/promises');
import { CookedCommand, CookedConfig, CookedEditorRuntime, PreparedCookedSource, runCookedCommand } from '../../libraries/nestjs-libraries/src/media-editing/cooked-editor-runtime';

describe('private cooked native boundary', () => {
  let root: string, config: CookedConfig, input: PreparedCookedSource, calls: CookedCommand[];
  const observedAudio = () => {
    const candidate = { index: 0, codec_name: 'aac', sample_rate: '44100', channels: 1,
      time_base: '1/44100', start_pts: 0, start_time: '0.000000' };
    return { state: 'observed', sha256: 'a'.repeat(64), toolVersion: 'fixture-ffprobe', candidates: [candidate],
      selectedStream: { ...candidate }, presentationOrigin: { numerator: 0, denominator: 1, basis: 'source-presentation-PTS-only' } };
  };
  const runner = async (c: CookedCommand) => {
    calls.push(c);
    if (c.stage === 'prepare_boundaries') await writeFile(join(c.workspace, 'edit/boundary-policy.json'), JSON.stringify({
      version: 'quiet-block-v1', sourceSha256: createHash('sha256').update(await readFile(join(c.workspace, 'source.mp4'))).digest('hex'), blocks: [[1, 2], [3, 5]] }));
    if (c.stage === 'transcribe') {
      const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
      const source = hash(await readFile(join(c.workspace, 'source.mp4'))), raw = Buffer.from('[{"text":"um"}]');
      await writeFile(join(c.workspace, 'edit/words.raw.json'), raw);
      const unknown = { state: 'unknown', reason: 'fixture-unobserved' };
      await writeFile(join(c.workspace, 'edit/alignment-observation.json'), JSON.stringify({
        version: 'alignment-observation-v1', status: 'INCOMPLETE', sourceSha256: source, sourceAfterSha256: source,
        rawAlignmentBytesSha256: hash(raw), upstream: { commit: 'bce911c1d0652f30b64fd5283cc4aa9fa92811c9',
          transcribeSha256: '9964a0bb316e75d666cce6b2f7ebe7d5414b6e3d293c38c8cd22d77e5dd2102e' },
        sourceAudio: unknown, configuredModel: { basis: 'configured-file-hashes-only', actualLoadedModel: unknown,
          files: { 'model.bin': null, 'config.json': null, 'tokenizer.json': null, 'vocabulary.txt': null } },
        extraction: { requested: { sampleRate: 16000, channels: 1, codec: 'pcm_s16le' }, toolVersion: null, wav: unknown },
        decoderArray: unknown, effectiveOptions: unknown, quietBlockVAD: unknown, outputPCM: unknown,
      }), { mode: 0o600 });
    }
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
    input = { orgId: 'o', mediaId: 'm', sourcePath, metadata: { durationMs: 10_000, width: 1280, height: 720, fps: 30, hasAudio: true, alignedTimestamps: true } };
  });
  afterEach(async () => { delete process.env.COOKED_SECRET_TEST; await rm(root, { recursive: true, force: true }); });
  it('uses native commands, excludes secrets, preserves source and scopes cleanup', async () => {
    process.env.COOKED_SECRET_TEST = 'never pass';
    const runtime = new CookedEditorRuntime(config, runner), receipt = await runtime.run(input);
    expect(calls.map(c => c.stage)).toEqual(['prepare_boundaries', 'transcribe', 'build_timeline', 'render', 'audit_render', 'verify', 'review_start', 'review_final']);
    expect(calls[0].env).not.toHaveProperty('COOKED_SECRET_TEST');
    expect(calls[0].env.HOME).toBe(join(receipt.workspace, 'home'));
    expect(calls[0].env.HF_HUB_OFFLINE).toBe('1');
    const transcription = calls.find(c => c.stage === 'transcribe')!;
    expect(transcription.script).toContain('cooked-transcribe-observed.py');
    expect(transcription.args).toEqual([join(config.sourceRoot, 'plugins/ai-editor/skills/cut/scripts/transcribe.py'),
      join(receipt.workspace, 'source.mp4'), join(receipt.editDirectory, 'words.raw.json'), '--engine', 'whisper', '--lang', 'en']);
    expect(calls[0].rssBytes).toBe(768 * 1024 * 1024);
    expect(await readFile(receipt.cutPath, 'utf8')).toBe('native cut');
    await expect(runtime.cleanup(receipt.jobId, 'other')).rejects.toThrow('NOT_OWNED');
    await expect(runtime.cleanup('../../source.mp4', 'o')).rejects.toThrow('NOT_OWNED');
    expect(await runtime.cleanup(receipt.jobId, 'o')).toMatchObject({ removed: true });
    expect(await readFile(input.sourcePath, 'utf8')).toBe('original');
  });
  it.each(['missing', 'partial', 'oversize', 'symlink', 'source', 'raw', 'binding', 'unknowns', 'shape'])(
    'rejects %s observations before rendering without retry and retains cleanup recovery', async sabotage => {
      const runtime = new CookedEditorRuntime(config, async c => {
        await runner(c);
        if (c.stage !== 'transcribe') return;
        const path = join(c.workspace, 'edit/alignment-observation.json');
        if (sabotage === 'missing') await rm(path);
        if (sabotage === 'partial') await writeFile(path, '{"version":');
        if (sabotage === 'oversize') await writeFile(path, ' '.repeat(256 * 1024 + 1));
        if (sabotage === 'symlink') { await rm(path); await symlink(input.sourcePath, path); }
        if (sabotage === 'source') await writeFile(join(c.workspace, 'source.mp4'), 'changed');
        if (sabotage === 'raw') await writeFile(join(c.workspace, 'edit/words.raw.json'), 'changed');
        if (sabotage === 'binding' || sabotage === 'unknowns' || sabotage === 'shape') {
          const receipt = JSON.parse(await readFile(path, 'utf8'));
          if (sabotage === 'binding') receipt.sourceAfterSha256 = '0'.repeat(64);
          else if (sabotage === 'shape') receipt.extraction = true;
          else delete receipt.decoderArray;
          await writeFile(path, JSON.stringify(receipt));
        }
      });
      const failure = await runtime.run(input).catch(e => e);
      expect(failure).toMatchObject({ message: 'OBSERVATION_PROTOCOL_FAILURE', jobId: expect.any(String) });
      expect(calls.map(c => c.stage)).toEqual(['prepare_boundaries', 'transcribe']);
      await expect(runtime.revise(failure.jobId, 'o', { cut: [[1, 2]] }, 0)).rejects.toThrow('STALE_OR_FAILED');
      await runtime.cleanup(failure.jobId, 'o');
    });
  it.each([
    ['review-repro', (a: any) => { Object.keys(a).forEach(key => delete a[key]); a.state = 'observed'; a.candidates = [null]; }],
    ['null-candidate', (a: any) => { a.candidates = [null]; }],
    ['missing-candidate-field', (a: any) => { delete a.candidates[0].sample_rate; }],
    ['candidate-field-type', (a: any) => { a.candidates[0].channels = '1'; }],
    ['invalid-rate', (a: any) => { a.candidates[0].sample_rate = 'unavailable'; }],
    ['invalid-time-base', (a: any) => { a.candidates[0].time_base = '44100'; }],
    ['missing-probe-hash', (a: any) => { delete a.sha256; }],
    ['invalid-probe-hash', (a: any) => { a.sha256 = 'z'.repeat(64); }],
    ['missing-version', (a: any) => { delete a.toolVersion; }],
    ['missing-selection', (a: any) => { delete a.selectedStream; }],
    ['mismatched-selection', (a: any) => { a.selectedStream.index = 1; }],
    ['ambiguous-selection', (a: any) => { a.candidates.push({ ...a.candidates[0], index: 1 }); }],
    ['missing-origin', (a: any) => { delete a.presentationOrigin; }],
    ['partial-origin', (a: any) => { delete a.presentationOrigin.numerator; }],
    ['invalid-origin', (a: any) => { a.presentationOrigin.denominator = 0; }],
    ['wrong-origin-basis', (a: any) => { a.presentationOrigin.basis = 'decoded-zero'; }],
    ['implicit-unknown', (a: any) => { a.presentationOrigin = { state: 'unknown' }; }],
  ])('rejects malformed observed audio: %s', async (_name, sabotage) => {
    const runtime = new CookedEditorRuntime(config, async c => {
      await runner(c);
      if (c.stage !== 'transcribe') return;
      const path = join(c.workspace, 'edit/alignment-observation.json'), receipt = JSON.parse(await readFile(path, 'utf8'));
      receipt.sourceAudio = observedAudio(); sabotage(receipt.sourceAudio);
      await writeFile(path, JSON.stringify(receipt));
    });
    const failure = await runtime.run(input).catch(e => e);
    expect(failure).toMatchObject({ message: 'OBSERVATION_PROTOCOL_FAILURE', jobId: expect.any(String) });
    expect(calls.map(c => c.stage)).toEqual(['prepare_boundaries', 'transcribe']);
    await runtime.cleanup(failure.jobId, 'o');
  });
  it.each(['single', 'nullable-fields', 'ambiguous', 'no-streams'])('accepts structurally valid incomplete audio: %s', async variant => {
    const runtime = new CookedEditorRuntime(config, async c => {
      await runner(c);
      if (c.stage !== 'transcribe') return;
      const path = join(c.workspace, 'edit/alignment-observation.json'), receipt = JSON.parse(await readFile(path, 'utf8'));
      const audio: any = observedAudio(), unknown = { state: 'unknown', reason: 'fixture-unobserved' };
      if (variant === 'nullable-fields') {
        audio.candidates[0] = Object.fromEntries(Object.keys(audio.candidates[0]).map(key => [key, null]));
        audio.selectedStream = { ...audio.candidates[0] }; audio.presentationOrigin = unknown; audio.toolVersion = null;
      }
      if (variant === 'ambiguous' || variant === 'no-streams') {
        audio.candidates = variant === 'no-streams' ? [] : [...audio.candidates, { ...audio.candidates[0], index: 1 }];
        audio.selectedStream = unknown; audio.presentationOrigin = unknown;
      }
      if (variant === 'single') receipt.extraction.wav = { state: 'observed', sha256: 'b'.repeat(64),
        sampleRate: 16000, channels: 1, sampleWidthBytes: 2, sampleCount: 1600, compression: 'NONE', origin: unknown };
      receipt.sourceAudio = audio; await writeFile(path, JSON.stringify(receipt));
    });
    const result = await runtime.run(input);
    expect(calls.some(c => c.stage === 'render')).toBe(true);
    await runtime.cleanup(result.jobId, 'o');
  });
  it.each(['valid', 'python-json', 'hash', 'bytes', 'references', 'order', 'model', 'budget', 'unsupported', 'canonical', 'count', 'python-vad', 'tag-field', 'tag-view', 'tag-extra', 'tag-nan', 'tag-negative', 'raw-nan', 'raw-infinity', 'raw-negative'])(
    'validates native observed bindings and bounds: %s', async variant => {
      const raw = (canonicalUTF8: string) => ({ canonicalUTF8,
        byteCount: Buffer.byteLength(canonicalUTF8), sha256: createHash('sha256').update(canonicalUTF8).digest('hex') });
      const bind = (data: any) => raw(JSON.stringify(data));
      const runtime = new CookedEditorRuntime(config, async c => {
        await runner(c); if (c.stage !== 'transcribe') return;
        const path = join(c.workspace, 'edit/alignment-observation.json'), r = JSON.parse(await readFile(path, 'utf8'));
        const files = { ...r.configuredModel.files, 'model.bin': 'a'.repeat(64) };
        const m = { id: 'model-1', constructorCodeSha256: 'b'.repeat(64), filesBefore: files, filesAfter: { ...files },
          requested: bind({ device: 'cpu' }), sdkVersion: bind('fixture'), actualSettings: bind({}) };
        const call = { id: 1, modelId: m.id, explicit: bind({ vad_filter: true }), defaulted: bind({}), returned: bind({ language: 'en' }) };
        if (variant === 'python-vad') {
          const code = 'import importlib.util,json,sys; s=importlib.util.spec_from_file_location("o",sys.argv[1]); o=importlib.util.module_from_spec(s); s.loader.exec_module(o); print(json.dumps(o.binding({"vad_options":{"max_speech_duration_s":float("inf")}},returned_options=True)))';
          call.returned = JSON.parse(execFileSync('python3', ['-I', '-B', '-c', code, join(__dirname,
            '../../libraries/nestjs-libraries/src/media-editing/cooked-transcribe-observed.py')], { encoding: 'utf8' }));
        }
        if (variant.startsWith('tag-')) {
          const tag: any = { $sdkNumber: variant === 'tag-nan' ? 'NaN' : variant === 'tag-negative' ? 'negative-infinity' : 'positive-infinity' };
          if (variant === 'tag-extra') tag.extra = true;
          call.returned = bind({ vad_options: { [variant === 'tag-field' ? 'threshold' : 'max_speech_duration_s']: tag } });
          if (variant === 'tag-view') { call.explicit = call.returned; call.returned = bind({}); }
        }
        if (variant.startsWith('raw-')) call.returned = raw('{"vad_options":{"max_speech_duration_s":' +
          (variant === 'raw-nan' ? 'NaN' : variant === 'raw-negative' ? '-Infinity' : 'Infinity') + '}}');
        if (variant === 'python-json') {
          call.returned.canonicalUTF8 = '{"language":"\\u00e9","probability":1e-07}';
          call.returned.byteCount = Buffer.byteLength(call.returned.canonicalUTF8);
          call.returned.sha256 = createHash('sha256').update(call.returned.canonicalUTF8).digest('hex');
        }
        if (variant === 'hash') call.explicit.sha256 = '0'.repeat(64);
        if (variant === 'canonical') call.explicit = bind({ z: 1, a: 2 });
        if (variant === 'bytes') call.explicit.byteCount++;
        if (variant === 'references') call.modelId = 'model-2';
        if (variant === 'order') call.id = 2;
        if (variant === 'model') m.filesAfter['model.bin'] = 'c'.repeat(64);
        if (variant === 'budget') call.returned = bind('x'.repeat(65536));
        if (variant === 'unsupported') call.returned = bind([[[[[[[[[[[[[1]]]]]]]]]]]]]);
        r.configuredModel.actualLoadedModel = { state: 'observed', models: [m] };
        r.effectiveOptions = { state: 'observed', basis: 'transcribe-API-calls', calls: Array(variant === 'count' ? 65 : 1).fill(call),
          byteCount: [m.requested, m.sdkVersion, m.actualSettings, call.explicit, call.defaulted, call.returned].reduce((n, b) => n + b.byteCount, 0) };
        await writeFile(path, JSON.stringify(r));
      });
      const result = await runtime.run(input).catch(e => e);
      if (['valid', 'python-json', 'python-vad'].includes(variant)) expect(calls.some(c => c.stage === 'render')).toBe(true);
      else { expect(result.message).toBe('OBSERVATION_PROTOCOL_FAILURE'); expect(calls.map(c => c.stage)).toEqual(['prepare_boundaries', 'transcribe']); }
      await runtime.cleanup(result.jobId, 'o');
    });
  it('fails closed for unsupported metadata, missing files, symlinks, nonprivate roots and unsafe limits', async () => {
    const runtime = new CookedEditorRuntime(config, runner);
    for (const metadata of [{ ...input.metadata, fps: 31 }, { ...input.metadata, width: 1920, height: 1080 }, { ...input.metadata, durationMs: 240001 }, { ...input.metadata, alignedTimestamps: false }]) {
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
  it('accepts four minutes with bounded stages and keeps source-byte/resource limits', async () => {
    const runtime = new CookedEditorRuntime(config, runner);
    const made = await runtime.run({ ...input, metadata: { ...input.metadata, durationMs: 240_000 } });
    expect(calls[0].timeoutMs).toBeLessThanOrEqual(180_000);
    expect(calls[0].workspaceBytes).toBe(512 * 1024 * 1024);
    expect(() => new CookedEditorRuntime({ ...config, stageTimeoutMs: 180_001 })).toThrow('INVALID_LIMIT');
    expect(() => new CookedEditorRuntime({ ...config, overallTimeoutMs: 600_001 })).toThrow('INVALID_LIMIT');
    await runtime.cleanup(made.jobId, 'o');
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
    expect(calls.map(c => c.stage)).toEqual(['apply_edits', 'build_timeline', 'render', 'audit_render', 'verify', 'review_round']);
    expect(JSON.parse(await readFile(calls[0].args.at(-1)!, 'utf8'))).toEqual({ cut: [[1, 2]] });
    expect(calls[0].script).toContain('cooked-quiet-blocks.py');
    const restored = await runtime.revise(initial.jobId, 'o', { restore: [[1, 2]] }, 1);
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
    const failure = await runtime.revise(initial.jobId, 'o', { cut: [[1, 2]] }, 0).catch(e => e);
    expect(failure).toMatchObject({ message: 'NATIVE_verify_FAILED', revision: 0, previousRevisionRestored: true });
    expect(await readFile(initial.cutPath, 'utf8')).toBe('native cut');
    expect(await readFile(join(initial.editDirectory, 'review.json'), 'utf8')).toBe('{"round":1}');
    expect(await readdir(initial.editDirectory)).not.toContain('decisions.json');
    expect((await readdir(initial.workspace)).some(name => name.startsWith('verified-edit-') || name === 'rejected-edit')).toBe(false);
    reject = false;
    const next = await runtime.revise(initial.jobId, 'o', { cut: [[3, 5]] }, 0);
    expect(next.revision).toBe(1);
    expect((await runtime.revise(initial.jobId, 'o', { restore: [[3, 5]] }, 1)).revision).toBe(2);
    expect(await readFile(input.sourcePath, 'utf8')).toBe('original');
    await runtime.cleanup(initial.jobId, 'o');
  });
  it('rejects captured word/arbitrary ranges and pause edits without mutation or revision loss', async () => {
    const runtime = new CookedEditorRuntime(config, runner), initial = await runtime.run(input); calls = [];
    for (const edits of [{ cut: [[1.48, 1.62]] }, { cut: [[1.48, 2.08]] }, { pause: [[3, 4]] },
      { restore: [[1, 2]] }, { cut: [[1, 2], [1, 2]] }]) {
      await expect(runtime.revise(initial.jobId, 'o', edits as any, 0)).rejects.toThrow('UNSUPPORTED_BLOCK_EDIT');
    }
    expect(calls).toHaveLength(0);
    expect(await readFile(initial.cutPath, 'utf8')).toBe('native cut');
    expect(initial.blocks).toEqual([[1, 2], [3, 5]]);
    expect((await runtime.revise(initial.jobId, 'o', { cut: [[3, 5]] }, 0)).removedBlocks).toEqual([[3, 5]]);
    await expect(runtime.revise(initial.jobId, 'o', { cut: [[3, 5]] }, 1)).rejects.toThrow('UNSUPPORTED_BLOCK_EDIT');
    expect((await runtime.revise(initial.jobId, 'o', { restore: [[3, 5]] }, 1)).removedBlocks).toEqual([]);
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
      await expect(runtime.revise(initial.jobId, 'o', { cut: [[1, 2]] }, 0)).rejects.toMatchObject({ previousRevisionRestored: false });
      await expect(runtime.revise(initial.jobId, 'o', { cut: [[3, 5]] }, 1)).rejects.toThrow('STALE_OR_FAILED');
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
      await expect(runtime.revise(initial.jobId, 'o', { cut: [[1, 2]] }, 0)).rejects.toMatchObject({ previousRevisionRestored: false });
      await expect(runtime.revise(initial.jobId, 'o', { cut: [[3, 5]] }, 1)).rejects.toThrow('STALE_OR_FAILED');
      await runtime.cleanup(initial.jobId, 'o');
    }
  });
  it('bounds checkpoint allocation before native mutation and rejects unsafe checkpoint files', async () => {
    const runtime = new CookedEditorRuntime({ ...config, workspaceBytes: 8 * 1024 * 1024 }, runner);
    const initial = await runtime.run(input); calls = [];
    await expect(runtime.revise(initial.jobId, 'o', { cut: [[1, 2]] }, 0)).rejects.toThrow('CHECKPOINT_LIMIT');
    expect(calls).toHaveLength(0); expect(await readFile(initial.cutPath, 'utf8')).toBe('native cut');
    await runtime.cleanup(initial.jobId, 'o');
    const other = new CookedEditorRuntime(config, runner), job = await other.run(input); calls = [];
    await symlink(input.sourcePath, join(job.editDirectory, 'unsafe-link'));
    await expect(other.revise(job.jobId, 'o', { cut: [[1, 2]] }, 0)).rejects.toThrow('WORKSPACE_SYMLINK');
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
