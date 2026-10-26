import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateStudioEvidence, validateStudioFraming } from '../../libraries/nestjs-libraries/src/media-editing/studio-evidence';
import { createCookedWorker } from '../../libraries/nestjs-libraries/src/media-editing/cooked-worker';
import { CookedWorkerClient } from '../../libraries/nestjs-libraries/src/media-editing/cooked-worker-client';
import { CookedReviewService } from '../../libraries/nestjs-libraries/src/media-editing/cooked-review.service';
import { Readable } from 'stream';

const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
function evidence() {
  const sha = hash('original'), raw = [0.1, .6, 3.1, 5.1].map((start, i) => ({ type: 'word', text: ['Keep', 'my', 'real', 'words'][i], start, end: start + .2 }));
  const value = (value: any) => ({ sha256: hash(JSON.stringify(value)), value });
  return { schemaVersion: 1, organizationId: 'org', mediaId: 'source', jobId: randomUUID(), revision: 0, sourceSha256: sha,
    fps: 30, totalFrames: 180, width: 360, height: 640, audio: { sha256: hash('aligned-audio'), bytes: 13 }, files: {
      rawWords: value(raw), words: value(raw.map(w => ({ ...w, start: w.start < 2 ? w.start : w.start - 1, end: w.end < 2 ? w.end : w.end - 1 }))),
      decisions: value([{ start: 0, end: 2 }, { start: 3, end: 6 }]),
      policy: value({ version: 'quiet-block-v1', sourceSha256: sha, fps: 30, total: 180 }), report: value({ policy: 'quiet-block-v1', fps: 30, final_s: 5, frames: [[0, 60], [90, 180]] }),
    } };
}
it('preserves actual native output-clock words and integer original-frame cuts', () => {
  const raw = evidence(), result = validateStudioEvidence(raw, { organizationId: 'org', mediaId: 'source', sourceSha256: raw.sourceSha256 });
  assert.equal(result.frames, 150); assert.equal(result.totalFrames, 180);
  assert.equal(result.cuts[1].in, 90); assert.equal(result.words[2].start, raw.files.words.value[2].start);
  assert.equal(result.words.map(w => w.text).join(' '), 'Keep my real words');
});
it.each(['organizationId', 'mediaId', 'sourceSha256', 'fps', 'totalFrames'])('rejects mismatched %s before directing', key => {
  const raw: any = evidence(); raw[key] = key === 'fps' ? 29.97 : key === 'totalFrames' ? 1801 : 'foreign';
  assert.throws(() => validateStudioEvidence(raw, { organizationId: 'org', mediaId: 'source' }));
});
it('rejects missing timestamps, altered words, wrong output clocks and cuts through speech', () => {
  const mutate = [(v: any) => delete v.files.words.value[0].start, (v: any) => v.files.words.value[0].text = 'invented',
    (v: any) => v.files.words.value[2].start += 1, (v: any) => v.files.rawWords.value[1].end = 2.1];
  for (const change of mutate) { const raw = evidence(); change(raw); assert.throws(() => validateStudioEvidence(raw, { organizationId: 'org', mediaId: 'source' })); }
});
it('requires a real stationary/single-speaker confirmation and bounded observation', () => {
  const f = { x: .28, y: .28, width: .44, height: .24, confirmed: true, stationary: true, singleSpeaker: true };
  assert.equal(validateStudioFraming(f).x, .28);
  for (const bad of [{ stationary: false }, { singleSpeaker: false }, { confirmed: false }, { width: 2 }, { x: NaN }, { detected: true }]) assert.throws(() => validateStudioFraming({ ...f, ...bad }));
});
it('exports actual private IPC snapshots, rejects stale/foreign requests and retains copied custody after close', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-ipc-'))), source = join(root, 'input.mp4'), raw: any = evidence();
  await writeFile(source, 'original'); let receipt: any, nativeRuns = 0;
  const runtime = { run: async (input: any) => {
    nativeRuns++;
    const workspace = await mkdtemp(join(root, 'native-')), editDirectory = join(workspace, 'edit'); await mkdir(editDirectory);
    await copyFile(input.sourcePath, join(workspace, 'source.mp4')); await writeFile(join(editDirectory, 'cut.mp4'), 'aligned-audio');
    for (const [key, name] of Object.entries({ rawWords: 'words.raw.json', words: 'words.json', decisions: 'decisions.json', policy: 'boundary-policy.json', report: 'report.json' })) await writeFile(join(editDirectory, name), JSON.stringify(raw.files[key].value));
    await writeFile(join(editDirectory, 'review.json'), JSON.stringify({ stage: 'cut', round: 1, rounds: [] }));
    receipt = { jobId: raw.jobId, revision: 0, sourceSha256: raw.sourceSha256, workspace, editDirectory, cutPath: join(editDirectory, 'cut.mp4'), blocks: [], removedBlocks: [] }; return receipt;
  }, cleanup: async () => rm(receipt.workspace, { recursive: true }) };
  const server = createCookedWorker(runtime as any, root, root);
  const socket = process.platform === 'win32' ? '\\\\.\\pipe\\studio-evidence-' + randomUUID() : join(root, 'worker.sock');
  try {
    await new Promise<void>(resolve => server.listen(socket, resolve)); const client = new CookedWorkerClient(socket), request = randomUUID();
    await client.create('org', 'source', request, source, { durationMs: 6000, width: 360, height: 640, fps: 30, alignedTimestamps: true, hasAudio: true });
    const snapshot = await client.studioEvidence('org', 'source', raw.jobId, 0);
    assert.equal(JSON.stringify(snapshot).includes(root), false); validateStudioEvidence(snapshot, { organizationId: 'org', mediaId: 'source' });
    await assert.rejects(client.studioEvidence('foreign', 'source', raw.jobId, 0));
    await assert.rejects(client.studioEvidence('org', 'source', raw.jobId, 1));
    await assert.rejects(client.studioAudio('org', 'source', raw.jobId, 0, hash('wrong'), 13, join(root, 'wrong.mp4')));
    const retained = join(root, 'retained.mp4'), originalCall = (client as any).call.bind(client);
    (client as any).call = async () => Object.assign(new Readable({ read() { this.push('ali'); this.destroy(Error('interrupted transfer')); } }), { statusCode: 200, headers: { 'content-length': snapshot.audio.bytes } });
    await assert.rejects(client.studioAudio('org', 'source', raw.jobId, 0, snapshot.audio.sha256, snapshot.audio.bytes, retained));
    await assert.rejects(readFile(retained)); // Partial transfer never occupies the final name.
    (client as any).call = originalCall;
    await client.studioAudio('org', 'source', raw.jobId, 0, snapshot.audio.sha256, snapshot.audio.bytes, retained);
    assert.equal(nativeRuns, 1);
    await client.json('/find?request=' + request, 'org', 'source', 'DELETE');
    assert.equal(hash(await readFile(retained)), snapshot.audio.sha256); assert.equal((await readFile(source)).toString(), 'original');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
it.each([429, 503, undefined])('distinguishes proven native admission rejection (%s) from uncertain transport', async status => {
  const root = await mkdtemp(join(tmpdir(), 'studio-admission-')), source = join(root, 'source.mp4'); await writeFile(source, 'original');
  try {
    const service = new CookedReviewService({ getMediaByOrganizationIdAndId: async () => ({ type: 'video', path: source }) } as any,
      { probeForCooked: async () => ({ fps: 30, width: 360, height: 640, durationMs: 6000 }) } as any);
    (service as any).readyClient = async () => ({ json: async () => { throw Object.assign(Error('absent'), { status: 404 }); },
      create: async () => { throw Object.assign(Error('native rejection or transport loss'), { status }); } });
    let result: any; try { await service.studioSource('org', 'source', randomUUID(), root, true); } catch (e) { result = e; }
    assert.ok(result); assert.equal(result.studioNotAdmitted === true, status === 429 || status === 503);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('never labels a known existing native job as not admitted when later export is pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-existing-')), source = join(root, 'source.mp4'); await writeFile(source, 'original');
  try {
    const service = new CookedReviewService({ getMediaByOrganizationIdAndId: async () => ({ type: 'video', path: source }) } as any,
      { probeForCooked: async () => ({ fps: 30, width: 360, height: 640, durationMs: 6000 }) } as any);
    (service as any).readyClient = async () => ({ json: async () => ({ status: 'working', jobId: randomUUID(), revision: 0 }) });
    let result: any; try { await service.studioSource('org', 'source', randomUUID(), root, true); } catch (e) { result = e; }
    assert.ok(result); assert.notEqual(result.studioNotAdmitted, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
