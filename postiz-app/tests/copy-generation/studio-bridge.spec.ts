import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { acceptStudioReceipt, studioFingerprint } from '../../libraries/nestjs-libraries/src/media-editing/studio-receipt';
import { assertStudioPlan, stageStudioPlan, studioDirectory, studioCommand } from '../../libraries/nestjs-libraries/src/media-editing/studio-worker';
import { StudioEditRepository } from '../../libraries/nestjs-libraries/src/media-editing/studio-edit.repository';

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
    storagePath: '/immutable.mp4', technicalReceipt: { sha256: h }, input: { media: [{ id: 'source', path: '/source.mp4' }] } };
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
