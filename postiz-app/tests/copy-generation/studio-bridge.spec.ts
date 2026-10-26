import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { acceptStudioReceipt, studioFingerprint } from '../../libraries/nestjs-libraries/src/media-editing/studio-receipt';
import { assertStudioPlan, stageStudioPlan, studioDirectory, studioCommand } from '../../libraries/nestjs-libraries/src/media-editing/studio-worker';
import { StudioEditRepository } from '../../libraries/nestjs-libraries/src/media-editing/studio-edit.repository';
import { StudioEditService } from '../../libraries/nestjs-libraries/src/media-editing/studio-edit.service';
import { normalizeStudioRequest } from '../../libraries/nestjs-libraries/src/media-editing/studio-edit.repository';

const h = 'a'.repeat(64), changed = 'b'.repeat(64);
function receipts() {
  const bindings = { projectId: 'job', revision: 1, profile: 'easy-graphics-v1', projectHash: h, prepareReceiptSha256: h,
    sourceSha256: h, fontSha256: h, audioSha256: h, rendererHash: h, runtimeHash: h, runtimeConfigSha256: h, lockfileSha256: h,
    assetHashes: { source: h }, audioTimeline: { sourceSha256: h, fps: 30, cuts: [[0, 180]] },
    toolHashes: Object.fromEntries(['nodeExecutable', 'pythonExecutable', 'browserExecutable', 'ffmpegExecutable', 'ffprobeExecutable'].map(k => [k, h])),
    packages: { '@remotion/bundler': '4.0.530', '@remotion/renderer': '4.0.530', '@remotion/player': '4.0.530', remotion: '4.0.530', react: '19.0.0', 'react-dom': '19.0.0', esbuild: '0.28.1' } };
  const render = { schemaVersion: 1, status: 'RENDERED_QA_PENDING', bindings, projectId: 'job', revision: 1, profile: 'easy-graphics-v1',
    projectHash: h, rendererHash: h, sha256: h, frames: 180, seconds: 6, canvas: { width: 1080, height: 1920, fps: 30 } };
  const qa = { ...render, status: 'PASS', acceptance: 'TECHNICAL_PASS_CREATIVE_REVIEW_REQUIRED', creativeApproval: 'PENDING',
    continuousHumanListening: 'NOT_CLAIMED', fullDecode: 'PASS', sourcePreserved: true, projectSha256: h, durationSeconds: 6,
    resolution: [1080, 1920], fps: 30, audioLagMs: 0, audioCorrelation: .999, audioWindows: [{ correlation: .999 }], limitations: ['Review focal framing'] };
  return { bindings, render, qa, expected: { projectId: 'job', revision: 1, sourceSha256: h } };
}
it('accepts complete matching technical receipts and preserves pending human review', () => {
  const f = receipts(), accepted = acceptStudioReceipt(f.render, f.qa, f.bindings, h, f.expected);
  assert.equal(accepted.creativeApproval, 'PENDING'); assert.equal(accepted.acceptance, 'TECHNICAL_PASS_CREATIVE_REVIEW_REQUIRED');
});
it.each(['runtimeHash', 'rendererHash', 'fontSha256', 'audioSha256', 'projectHash', 'prepareReceiptSha256', 'lockfileSha256'])('rejects current %s drift', key => {
  const f = receipts(); assert.throws(() => acceptStudioReceipt(f.render, f.qa, { ...f.bindings, [key]: changed }, h, f.expected));
});
it.each(['status', 'creativeApproval', 'fullDecode', 'continuousHumanListening', 'acceptance'])('rejects missing required QA %s', key => {
  const f = receipts(); delete (f.qa as any)[key]; assert.throws(() => acceptStudioReceipt(f.render, f.qa, f.bindings, h, f.expected));
});
it('rejects output tampering, generation mismatch and incomplete audio/duration evidence', () => {
  const f = receipts();
  assert.throws(() => acceptStudioReceipt(f.render, f.qa, f.bindings, changed, f.expected));
  assert.throws(() => acceptStudioReceipt(f.render, f.qa, f.bindings, h, { ...f.expected, revision: 2 }));
  assert.throws(() => acceptStudioReceipt(f.render, { ...f.qa, audioCorrelation: .5 }, f.bindings, h, f.expected));
  assert.throws(() => acceptStudioReceipt({ ...f.render, seconds: undefined }, f.qa, f.bindings, h, f.expected));
});
it('canonical fingerprints ignore key order but preserve asset/audio identities', () => {
  assert.equal(studioFingerprint({ a: h, b: [1, 2] }), studioFingerprint({ b: [1, 2], a: h }));
  assert.notEqual(studioFingerprint({ a: h }), studioFingerprint({ a: changed }));
});

function planFixture() {
  const job = { id: randomUUID(), generation: 1, input: { request: { sourceMediaId: 'video', brollMediaIds: ['still'], destinations: ['linkedin'], profile: 'easy-graphics-v1' }, media: [] as any[] } };
  const plan = { assetMediaIds: { source: 'video', panel: 'still' }, manifest: { schemaVersion: 1,
    project: { profile: 'easy-graphics-v1', source: { assetId: 'source', sha256: h }, assets: [{ id: 'source', kind: 'video', duration: 6, sha256: h }, { id: 'panel', kind: 'image', sha256: h }], safeZones: { profiles: ['linkedin-organic-v1'] } },
    provenance: { origin: 'approved-edl', originalSourceSha256: h, proxy: null, cooked: null }, inputs: {} } };
  return { job, plan };
}
it('accepts explicit admitted media/destinations without mutating the authored plan', () => {
  const f = planFixture(), before = JSON.stringify(f); assertStudioPlan(f.job, f.plan); assert.equal(JSON.stringify(f), before);
});
it('rejects unadmitted media, proxies, missing destination profiles and long sources', () => {
  const f = planFixture();
  assert.throws(() => assertStudioPlan(f.job, { ...f.plan, assetMediaIds: { ...f.plan.assetMediaIds, panel: 'foreign' } }));
  for (const mutate of [(p: any) => p.provenance.proxy = {}, (p: any) => p.project.safeZones.profiles = ['youtube-ad-derived-v1'],
    (p: any) => p.project.assets[0].duration = 61]) {
    const plan = JSON.parse(JSON.stringify(f.plan)); mutate(plan.manifest); assert.throws(() => assertStudioPlan(f.job, plan));
  }
});
it('never resolves a request into an arbitrary workspace path', () => {
  const f = planFixture(); assert.throws(() => studioDirectory({ work: '/fixture' } as any, { ...f.job, id: '../outside' }));
});
it('recovery refuses a changed plan before asset preparation or native dispatch', async () => {
  const f = planFixture(), dir = await mkdtemp(join(tmpdir(), 'studio-bridge-'));
  try {
    const config = { work: dir } as any, root = studioDirectory(config, f.job); await mkdir(root, { recursive: true });
    await writeFile(join(root, 'plan-fingerprint.json'), JSON.stringify({ sha256: changed }));
    await assert.rejects(stageStudioPlan(config, f.job, f.plan), /plan changed/);
    assert.equal(JSON.parse(await readFile(join(root, 'plan-fingerprint.json'), 'utf8')).sha256, changed);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('does not run the app worker on an unaccepted Windows runtime', async () => {
  if (process.platform === 'linux') return; // Linux runtime execution is a separate joined gate.
  await assert.rejects(studioCommand({} as any, 'render', []), /Linux acceptance/);
});
it('review is transactionally replayable and rejects changed content or deleted output', async () => {
  const row: any = { id: randomUUID(), organizationId: 'org', generation: 1, state: 'TECHNICAL_READY', artifactSha256: h, artifactBytes: 12,
    storagePath: '/immutable.mp4', reviewedAt: new Date(), technicalReceipt: { sha256: h }, input: { media: [{ id: 'source', path: '/source.mp4' }] } };
  let output: any, creates = 0;
  const tx: any = { $executeRaw: async () => 1, studioEditJob: { findFirst: async () => row, update: async ({ data }: any) => Object.assign(row, data) },
    media: { findMany: async () => row.input.media, findFirst: async () => output, create: async ({ data }: any) => { creates++; output = data; return output; } } };
  const jobs = new StudioEditRepository({ $transaction: async (f: any) => f(tx) } as any), fingerprint = studioFingerprint(row.technicalReceipt);
  const first = await jobs.review('org', row.id, 'reviewer', 1, h, fingerprint);
  assert.equal((await jobs.review('org', row.id, 'reviewer', 1, h, fingerprint)).id, first.id);
  assert.equal(creates, 1); assert.equal(row.state, 'REVIEWED');
  await assert.rejects(jobs.review('org', row.id, 'reviewer', 1, changed, fingerprint));
  output = null; await assert.rejects(jobs.review('org', row.id, 'reviewer', 1, h, fingerprint)); assert.equal(creates, 1);
});
it('unreviewed status exposes no permanent storage path and does not upload bytes', async () => {
  const row: any = { id: 'job', sourceMediaId: 'source', generation: 1, state: 'TECHNICAL_READY', artifactSha256: h,
    storagePath: 'https://public.invalid/secret.mp4', technicalReceipt: { limitations: [], safeZoneProfiles: ['linkedin-organic-v1'] } };
  const service = new StudioEditService({ get: async () => row } as any, {} as any);
  (service as any).assertOwned = async () => {}; (service as any).verified = async () => ({});
  const response = await service.status('org', 'job');
  assert.equal(response.preview, true); assert.equal(response.savedPath, undefined);
  assert.equal(JSON.stringify(response).includes(row.storagePath), false);
});
it('only explicit current-version consent can call permanent storage, and consent is durable first', async () => {
  const events: string[] = [], row: any = { id: randomUUID(), generation: 1, artifactSha256: h, artifactBytes: 3, technicalReceipt: { sha256: h } };
  const jobs = { get: async () => row, authorizeReviewedStorage: async () => { events.push('consent'); },
    recordReviewedStorage: async () => { events.push('storage-ack'); }, review: async () => { events.push('media'); return { id: 'one' }; } };
  const service = new StudioEditService(jobs as any, {} as any);
  (service as any).assertOwned = async () => {}; (service as any).verified = async () => ({ file: '/private/worker/final.mp4' });
  (service as any).storage = { storeStudioOutput: async () => { events.push('upload'); return {}; } };
  await assert.rejects(service.review('org', row.id, 'reviewer', { generation: 1, sha256: h, reviewed: false }));
  assert.equal(events.length, 0);
  await service.review('org', row.id, 'reviewer', { generation: 1, sha256: h, reviewed: true });
  assert.equal(events.join(','), 'consent,upload,storage-ack,media');
});
it('private preview rechecks organization and streams only the requested byte range', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-preview-'));
  try {
    const file = join(dir, 'final.mp4'); await writeFile(file, 'abcdef');
    const service = new StudioEditService({ get: async (org: string) => { if (org !== 'owner') throw Error('Unavailable'); return { state: 'TECHNICAL_READY' }; } } as any, {} as any);
    let checks = 0; (service as any).verified = async () => { checks++; return { file, bytes: 6 }; };
    const result = await service.preview('owner', 'job', 'bytes=1-3'), chunks: Buffer[] = [];
    for await (const part of result.stream) chunks.push(part);
    assert.equal(result.status, 206); assert.equal(Buffer.concat(chunks).toString(), 'bcd');
    await assert.rejects(service.preview('foreign', 'job')); assert.equal(checks, 1);
    await assert.rejects(service.preview('owner', 'job', 'bytes=9-')); await assert.rejects(service.preview('owner', 'job', 'bytes=3-1'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('lost permanent-storage acknowledgement does not create Media and the same approval can recover', async () => {
  const row: any = { id: randomUUID(), generation: 1, artifactSha256: h, artifactBytes: 3, technicalReceipt: { sha256: h } };
  let uploaded = false, uploads = 0, registrations = 0, acknowledged = false;
  const jobs = { get: async () => row, authorizeReviewedStorage: async () => { row.reviewedAt ||= new Date(); },
    recordReviewedStorage: async () => { acknowledged = true; }, review: async () => { assert.equal(acknowledged, true); registrations++; return { id: 'one' }; } };
  const service = new StudioEditService(jobs as any, {} as any);
  (service as any).assertOwned = async () => {}; (service as any).verified = async () => ({ file: '/private/final.mp4' });
  (service as any).storage = { storeStudioOutput: async () => {
    assert.ok(row.reviewedAt); if (!uploaded) { uploaded = true; uploads++; throw Error('acknowledgement lost'); } return {};
  } };
  const body = { generation: 1, sha256: h, reviewed: true };
  await assert.rejects(service.review('org', row.id, 'reviewer', body)); assert.equal(registrations, 0);
  assert.equal((await service.review('org', row.id, 'reviewer', body)).outputMedia.id, 'one'); assert.equal(uploads, 1);
});
it('normalizes new-upload direction/observation without accepting a manifest or changing legacy requests', () => {
  const request: any = { requestKey: randomUUID(), sourceMediaId: 'video', brollMediaIds: ['still'], destinations: ['linkedin'], profile: 'easy-graphics-v1' };
  assert.equal(Object.keys(normalizeStudioRequest(request)).length, 5);
  const creative = { brief: ' My words and visuals ', framing: { x: .28, y: .28, width: .44, height: .24, confirmed: true, stationary: true, singleSpeaker: true } };
  const normalized = normalizeStudioRequest({ ...request, creative }); assert.equal(normalized.creative!.brief, 'My words and visuals');
  assert.throws(() => normalizeStudioRequest({ ...request, creative, manifest: {} }));
  assert.throws(() => normalizeStudioRequest({ ...request, creative: { ...creative, framing: { ...creative.framing, stationary: false } } }));
});
async function withUploadProducer(test: (service: StudioEditService, row: any, counts: any) => Promise<void>, uncertain = false, admissionFailure?: 'known' | 'unknown') {
  const root = await mkdtemp(join(tmpdir(), 'studio-upload-')), privateRoot = join(root, 'private'), publicRoot = join(root, 'uploads');
  await mkdir(privateRoot); await mkdir(publicRoot);
  const env: Record<string, string | undefined> = {}, settings: Record<string, string> = { STUDIO_EDITOR_ENABLED: 'true', STUDIO_EDITOR_ORGANIZATIONS: 'owner',
    STUDIO_EDITOR_PACKAGE_ROOT: root, STUDIO_EDITOR_RUNTIME: join(root, 'runtime.json'), STUDIO_EDITOR_WORK_ROOT: privateRoot, UPLOAD_DIRECTORY: publicRoot };
  for (const key of Object.keys(settings)) { env[key] = process.env[key]; process.env[key] = settings[key]; }
  try {
    await writeFile(settings.STUDIO_EDITOR_RUNTIME, JSON.stringify({ nodeExecutable: process.execPath, pythonExecutable: process.execPath }));
    const request: any = { requestKey: randomUUID(), sourceMediaId: 'video', brollMediaIds: ['still'], destinations: ['linkedin'], profile: 'easy-graphics-v1',
      creative: { brief: 'My actual uploaded source', framing: { x: .28, y: .28, width: .44, height: .24, confirmed: true, stationary: true, singleSpeaker: true } } };
    const row: any = { id: randomUUID(), organizationId: 'owner', sourceMediaId: 'video', state: 'ADMITTED', generation: 1, inputFingerprint: h,
      input: { request, media: [{ id: 'video', path: '/owned/video.mp4' }, { id: 'still', path: '/owned/still.png' }] } };
    const counts = { native: 0, direction: 0, render: 0, actualNative: 0, allows: [] as boolean[] };
    const value = (value: any) => ({ value, sha256: h });
    const raw = { schemaVersion: 1, organizationId: 'owner', mediaId: 'video', jobId: randomUUID(), revision: 0, sourceSha256: h,
      fps: 30, totalFrames: 180, width: 360, height: 640, audio: { sha256: h, bytes: 13 }, files: {
        rawWords: value([{ type: 'word', text: 'uploaded', start: .1, end: .3 }]), words: value([{ type: 'word', text: 'uploaded', start: .1, end: .3 }]),
        policy: value({ version: 'quiet-block-v1', sourceSha256: h, fps: 30, total: 180 }),
        report: value({ fps: 30, policy: 'quiet-block-v1', final_s: 6, frames: [[0, 180]] }), decisions: value([{ start: 0, end: 6 }]) } };
    const jobs = { admit: async () => row, get: async () => row, claim: async () => { row.state = 'RUNNING'; row.leaseToken = randomUUID(); return row; } };
    const cooked = { studioSource: async (_org: string, _media: string, _request: string, dir: string, allowCreate: boolean) => {
      counts.native++; counts.allows.push(allowCreate);
      if (admissionFailure === 'known' && counts.native === 1) throw Object.assign(Error('busy, no job created'), { studioNotAdmitted: true });
      if (allowCreate) counts.actualNative++;
      if (admissionFailure === 'unknown' && counts.native === 1) throw Error('native response lost');
      await writeFile(join(dir, 'evidence.json'), JSON.stringify(raw)); return raw;
    } };
    const director = { prepareAssets: async () => [{ mediaId: 'video', sha256: h }], produce: async () => { counts.direction++; if (uncertain) throw Error('UNKNOWN'); return { generated: 'from current evidence' }; } };
    const db = { media: { findMany: async () => row.input.media } };
    const service = new StudioEditService(jobs as any, db as any, cooked as any, director as any);
    (service as any).renderApproved = async (_org: string, _job: string, plan: any) => { assert.equal(plan.generated, 'from current evidence'); counts.render++; row.state = 'TECHNICAL_READY'; };
    await service.create('owner', request); await (service as any).running.get('owner:' + row.id);
    await test(service, row, counts);
  } finally { for (const key of Object.keys(settings)) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } await rm(root, { recursive: true, force: true }); }
}
it('new-upload admission runs evidence -> generated direction -> render once and repeated creation recovers the same job', async () => {
  await withUploadProducer(async (service, row, counts) => {
    const recovered = await service.create('owner', row.input.request); assert.equal(recovered.id, row.id);
    assert.equal(counts.native, 1); assert.equal(counts.direction, 1); assert.equal(counts.render, 1);
    assert.equal(row.state, 'TECHNICAL_READY');
  });
});
it('resuming uncertain direction uses retained evidence and never starts a replacement native job', async () => {
  await withUploadProducer(async (service, row, counts) => {
    assert.equal(row.state, 'RUNNING'); assert.equal(counts.render, 0);
    await service.resume('owner', row.id); await (service as any).running.get('owner:' + row.id);
    assert.equal(counts.native, 1); assert.equal(counts.direction, 2); assert.equal(counts.render, 0);
    const status: any = await service.status('owner', row.id); assert.equal(status.phase, 'NEEDS_VERIFICATION');
  }, true);
});
it('a proven non-admission can retry after the worker becomes free without a stranded request', async () => {
  await withUploadProducer(async (service, row, counts) => {
    assert.equal(counts.actualNative, 0); assert.equal(row.state, 'RUNNING');
    const status: any = await service.status('owner', row.id); assert.equal(status.phase, 'WAITING_FOR_WORKER');
    await service.resume('owner', row.id); await (service as any).running.get('owner:' + row.id);
    assert.equal(counts.allows.join(','), 'true,true'); assert.equal(counts.actualNative, 1); assert.equal(counts.render, 1);
  }, false, 'known');
});
it('an uncertain native dispatch can only find the same job rather than create another', async () => {
  await withUploadProducer(async (service, row, counts) => {
    assert.equal(counts.actualNative, 1);
    await service.resume('owner', row.id); await (service as any).running.get('owner:' + row.id);
    assert.equal(counts.allows.join(','), 'true,false'); assert.equal(counts.actualNative, 1); assert.equal(counts.render, 1);
  }, false, 'unknown');
});
