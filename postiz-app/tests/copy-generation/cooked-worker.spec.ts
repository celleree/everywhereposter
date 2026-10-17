import { createServer } from 'http';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createCookedWorker } from '../../libraries/nestjs-libraries/src/media-editing/cooked-worker';
import { CookedWorkerClient } from '../../libraries/nestjs-libraries/src/media-editing/cooked-worker-client';
import { adaptCookedReviewHtml } from '../../libraries/nestjs-libraries/src/media-editing/cooked-review-html';

describe('private cooked worker protocol', () => {
  let root: string, server: ReturnType<typeof createServer>, client: CookedWorkerClient, runtime: any, revision: number, receipt: any;
  const org = 'org-a', media = 'source-a';
  const metadata = { durationMs: 10730, width: 640, height: 360, fps: 25, alignedTimestamps: true, hasAudio: true };
  async function review() {
    const edit = receipt.editDirectory, round = revision + 1;
    await writeFile(join(edit, 'review', `v-cut${round}.mp4`), 'synthetic-video-file');
    await writeFile(join(edit, 'review', `data-cut${round}.json`), JSON.stringify({ transcript: { lines: [] } }));
    const rounds = Array.from({ length: round }, (_, i) => ({ stage: 'cut', round: i + 1, video: join(edit, 'review', `v-cut${i + 1}.mp4`), data: 'private-path', snap: root }));
    await writeFile(join(edit, 'review.json'), JSON.stringify({ stage: 'cut', round, final: true, folder: root, src: root, video: rounds[round - 1].video, rounds }));
  }
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cooked-protocol-test-')); revision = 0;
    await mkdir(join(root, 'plugins/ai-editor/lib/ai_editor'), { recursive: true });
    await writeFile(join(root, 'plugins/ai-editor/lib/ai_editor/review.html'), '<head></head><div id="txlines"></div>');
    await writeFile(join(root, 'input.mp4'), 'owned-input');
    runtime = {
      run: jest.fn(async (input) => {
        const workspace = await mkdtemp(join(root, 'job-')), editDirectory = join(workspace, 'edit');
        await mkdir(join(editDirectory, 'review'), { recursive: true }); await copyFile(input.sourcePath, join(workspace, 'source.mp4'));
        receipt = { jobId: randomUUID(), revision, workspace, editDirectory, cutPath: join(editDirectory, 'cut.mp4'), sourceSha256: 'fixture' };
        await review(); return receipt;
      }),
      revise: jest.fn(async (_job, _org, edits, expected) => {
        if (expected !== revision || !edits.cut?.length) throw new Error('INVALID_EDITS');
        revision++; receipt = { ...receipt, revision }; await review(); return receipt;
      }),
      cleanup: jest.fn(async () => rm(receipt.workspace, { recursive: true })),
    };
    server = createCookedWorker(runtime, root, root); const socket = join(root, 'worker.sock');
    await new Promise<void>(resolve => server.listen(socket, resolve)); client = new CookedWorkerClient(socket);
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  async function create(request = randomUUID()) { return client.create(org, media, request, join(root, 'input.mp4'), metadata); }
  it('admits one retained session, deduplicates requests and scopes lookup/deletion by organization and media', async () => {
    const request = randomUUID(), first = await create(request); expect(first.status).toBe('ready');
    expect((await create(request)).jobId).toBe(first.jobId); expect(runtime.run).toHaveBeenCalledTimes(1);
    await expect(create()).rejects.toMatchObject({ status: 429 });
    await expect(client.json('/find?request=' + request, 'org-b', media)).rejects.toMatchObject({ status: 404 });
    await expect(client.json('/find?request=' + request, org, 'foreign-media', 'DELETE')).rejects.toMatchObject({ status: 404 });
    await client.json('/find?request=' + request, org, media, 'DELETE'); expect(runtime.cleanup).toHaveBeenCalledWith(first.jobId, org);
    expect(await readFile(join(root, 'input.mp4'), 'utf8')).toBe('owned-input');
    expect((await create()).status).toBe('ready');
  });
  it('sanitizes host paths, rejects foreign jobs/unsupported routes and preserves immutable media ranges', async () => {
    const first = await create(), path = '/jobs/' + first.jobId;
    const state = await client.json(path + '/state', org, media);
    expect(JSON.stringify(state)).not.toContain(root); expect(state.revision).toBe(0); expect(state.final).toBe(true);
    await expect(client.json(path + '/state', 'org-b', media)).rejects.toMatchObject({ status: 404 });
    for (const route of ['assets', 'update', 'trials', 'ask.js', 'theme']) await expect(client.json(path + '/' + route, org, media)).rejects.toMatchObject({ status: 404 });
    const response = await client.stream(path + '/video?k=cut-1', org, media, 'bytes=0-2');
    let result = ''; for await (const b of response) result += b;
    expect(response.statusCode).toBe(206); expect(result).toBe('syn');
    await expect(client.stream(path + '/video', org, media, 'bytes=999-')).rejects.toMatchObject({ status: 416 });
  });
  it('rejects stale/unknown edits without destroying a valid session and only revises through the runtime', async () => {
    const first = await create(), path = '/jobs/' + first.jobId;
    await expect(client.json(path + '/edits', org, media, 'POST', { revision: 1, cut: [[0, 1]] })).rejects.toMatchObject({ status: 409 });
    await expect(client.json(path + '/edits', org, media, 'POST', { revision: 0, sourcePath: '/other' })).rejects.toMatchObject({ status: 400 });
    expect(runtime.revise).not.toHaveBeenCalled();
    await expect(client.json(path + '/edits', org, media, 'POST', { revision: 0, cut: [] })).rejects.toMatchObject({ status: 422 });
    expect((await client.json(path + '/state', org, media)).revision).toBe(0);
    expect(await client.json(path + '/edits', org, media, 'POST', { revision: 0, cut: [[1, 2]] })).toEqual({ event: true, revision: 1 });
    expect(runtime.revise).toHaveBeenLastCalledWith(first.jobId, org, { cut: [[1, 2]] }, 0);
    expect((await client.json(path + '/state', org, media)).rounds).toHaveLength(2);
  });
  it('never serves a generated symlink outside its private job', async () => {
    const first = await create(); const file = join(receipt.editDirectory, 'review/v-cut1.mp4');
    await rm(file); await symlink(join(root, 'input.mp4'), file);
    await expect(client.stream('/jobs/' + first.jobId + '/video', org, media)).rejects.toMatchObject({ status: 404 });
    expect(await readFile(join(root, 'input.mp4'), 'utf8')).toBe('owned-input');
  });
  it('retires the worker before another tenant can enter, including when cleanup fails', async () => {
    const request = randomUUID(); await create(request);
    const retire = jest.fn(); server.once('sessionClosed', retire);
    runtime.cleanup.mockRejectedValueOnce(new Error('simulated owned filesystem failure'));
    await expect(client.json('/find?request=' + request, org, media, 'DELETE')).rejects.toMatchObject({ status: 500 });
    expect(retire).toHaveBeenCalledTimes(1);
    await expect(client.create('org-b', media, randomUUID(), join(root, 'input.mp4'), metadata)).rejects.toMatchObject({ status: 503 });
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });
  it('adapts only the expected native UI contract and binds edits to the displayed revision', () => {
    const html = '<head></head><div id="txlines"></div><script>fetch(\'/edits\',{method:\'POST\',body:JSON.stringify(body)});fetch(\'/state\');v.src=\'/video?k=\'+key</script><script src="/ask.js"></script>';
    const result = adaptCookedReviewHtml(html);
    expect(result).toContain("fetch('./state')"); expect(result).toContain("v.src='./video?k='");
    expect(result).toContain('revision:S.revision'); expect(result).toContain("'Content-Type':'application/json'"); expect(result).not.toContain('<script src='); expect(result).toContain('touch-action:none');
    expect(() => adaptCookedReviewHtml('<head></head>')).toThrow('UNSUPPORTED_NATIVE_REVIEW');
  });
});
