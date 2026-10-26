import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StudioDirectorService, compileStudioPlan, studioEffectBounds } from '../../libraries/nestjs-libraries/src/media-editing/studio-director.service';
import { studioFingerprint } from '../../libraries/nestjs-libraries/src/media-editing/studio-receipt';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture(text = 'Build systems with care') {
  const sha = hash(text), words = text.split(' ').map((text, i) => ({ type: 'word', text, start: [.1, .6, 3.1, 5.1][i], end: [.3, .8, 3.3, 5.3][i] }));
  const value = (value: any) => ({ value, sha256: hash(JSON.stringify(value)) });
  const framing = { x: .28, y: .28, width: .44, height: .24, confirmed: true as const, stationary: true as const, singleSpeaker: true as const };
  const raw: any = { schemaVersion: 1, organizationId: 'owner', mediaId: 'video', jobId: randomUUID(), revision: 0, sourceSha256: sha,
    fps: 30, totalFrames: 180, width: 360, height: 640, audio: { sha256: hash('aligned-audio'), bytes: 13 }, files: {
      rawWords: value(words), words: value(words.map(w => ({ ...w, start: w.start < 2 ? w.start : w.start - 1, end: w.end < 2 ? w.end : w.end - 1 }))),
      decisions: value([{ start: 0, end: 2 }, { start: 3, end: 6 }]), policy: value({ version: 'quiet-block-v1', fps: 30, total: 180, sourceSha256: sha }),
      report: value({ policy: 'quiet-block-v1', fps: 30, final_s: 5, frames: [[0, 60], [90, 180]] }) } };
  const assets: any[] = [{ id: 'source', mediaId: 'video', kind: 'video', file: 'assets/source.mp4', sha256: sha, duration: 6, fps: 30,
    width: 360, height: 640, path: '/private/source.mp4', evidence: 'Synthetic original' },
    { id: 'visual-1', mediaId: 'still', kind: 'image', file: 'assets/visual-1.png', sha256: hash('still-' + text), width: 360, height: 640, path: '/private/still.png', evidence: 'Synthetic registered still' }];
  const job: any = { id: randomUUID(), generation: 1, organizationId: 'owner', sourceMediaId: 'video', inputFingerprint: hash('input-' + text), input: { request: {
    profile: 'easy-graphics-v1', sourceMediaId: 'video', brollMediaIds: ['still'], destinations: ['linkedin'], creative: { brief: 'Illustrate my source concepts', framing } } } };
  const direction: any = { summary: 'Source-specific concepts for review', effects: [{ kind: 'relationship', anchorWordId: 'w0', labels: [
    { text: words[0].text, icon: 'document', assetId: '' }, { text: words[1].text, icon: 'product', assetId: '' } ] }],
    broll: [{ assetId: 'visual-1', anchorWordId: 'w2', reason: 'Creator-selected supporting visual; its semantics require review' }] };
  const refs: any = { font: { path: '/private/font.ttf', sha256: hash('font') }, audio: { path: '/private/cooked-audio.mp4', sha256: raw.audio.sha256 },
    decisions: { path: '/private/decisions.json', sha256: hash('decisions') }, captions: { path: '/private/captions.json', sha256: hash('captions') }, receipt: { path: '/private/receipt.json', sha256: hash('receipt') } };
  const rectangles = [{ x: 112 / 1080, y: 260 / 1920, width: 758 / 1080, height: 1100 / 1920 }], bounds = studioEffectBounds(rectangles, framing);
  return { raw, assets, job, framing, direction, refs, rectangles, bounds };
}
it('compiles two unrelated sources into distinct actual manifests while retaining native words/cuts/audio', () => {
  const plans = ['Build systems with care', 'Record stories for people'].map(source => {
    const f = fixture(source), plan = compileStudioPlan(f.job, f.raw, f.assets, f.framing, ['linkedin-organic-v1'], f.bounds, f.direction, f.refs);
    assert.equal(plan.manifest.project.words.map((w: any) => w.text).join(' '), source);
    assert.equal(plan.manifest.project.words[2].start, f.raw.files.words.value[2].start);
    assert.equal(plan.manifest.project.cuts[1].in, 90); assert.equal(plan.manifest.project.source.frames, 180);
    assert.equal(plan.manifest.inputs.audio.sha256, f.raw.audio.sha256); assert.equal(plan.manifest.provenance.proxy, null);
    assert.equal(plan.manifest.project.captions.flatMap((c: any) => c.wordIds).join(','), 'w0,w1,w2,w3');
    assert.equal(plan.manifest.project.effects[0].props.nodes[0].label, source.split(' ')[0]); return plan;
  });
  assert.notEqual(plans[0].manifest.project.source.sha256, plans[1].manifest.project.source.sha256);
});
it('never accepts model timestamps, coordinates, invented assets or unsupported props', () => {
  for (const change of [(d: any) => d.effects[0].bounds = {}, (d: any) => d.effects[0].anchorWordId = 'missing',
    (d: any) => d.broll[0].assetId = 'foreign', (d: any) => d.effects[0].labels[0].text = 'https://arbitrary.invalid',
    (d: any) => d.effects[0].labels[0].css = 'position:fixed']) {
    const f = fixture(); change(f.direction); assert.throws(() => compileStudioPlan(f.job, f.raw, f.assets, f.framing, ['linkedin-organic-v1'], f.bounds, f.direction, f.refs));
  }
});
it('rejects moving/multiple speaker claims, source drift and unfittable framing without inventing geometry', () => {
  const f = fixture();
  assert.throws(() => compileStudioPlan(f.job, f.raw, f.assets, { ...f.framing, stationary: false } as any, ['linkedin-organic-v1'], f.bounds, f.direction, f.refs));
  assert.throws(() => compileStudioPlan(f.job, f.raw, f.assets, { ...f.framing, sourceSha256: hash('other') }, ['linkedin-organic-v1'], f.bounds, f.direction, f.refs));
  assert.throws(() => studioEffectBounds(f.rectangles, { ...f.framing, x: 0, y: 0, width: 1, height: 1 }));
});
it('image panels consume registered stills only and preserve chosen labels', () => {
  const f = fixture(); f.direction.effects[0] = { kind: 'panels', anchorWordId: 'w0', labels: [{ text: 'Owned visual', assetId: 'visual-1', icon: 'document' }] };
  const plan = compileStudioPlan(f.job, f.raw, f.assets, f.framing, ['linkedin-organic-v1'], f.bounds, f.direction, f.refs);
  assert.equal(plan.manifest.project.effects[0].type, 'EasyMediaPanels');
  f.assets[1].kind = 'video'; assert.throws(() => compileStudioPlan(f.job, f.raw, f.assets, f.framing, ['linkedin-organic-v1'], f.bounds, f.direction, f.refs));
});
async function withProducer(run: (f: ReturnType<typeof fixture>, service: StudioDirectorService, dir: string, config: any) => Promise<void>, metered: any) {
  const f = fixture(), dir = await mkdtemp(join(tmpdir(), 'studio-director-'));
  try {
    await writeFile(join(dir, 'Body-Bold.ttf'), Buffer.from([0, 1, 0, 0, 1])); await writeFile(join(dir, 'cooked-audio.mp4'), 'aligned-audio');
    for (const name of ['decisions', 'captions', 'receipt']) await writeFile(join(dir, 'cooked-' + name + '.json'), '{}');
    const service = new StudioDirectorService(metered, { getSubscriptionByOrganizationId: async () => ({ subscriptionTier: 'LAUNCH_V1' }) } as any);
    (service as any).geometry = async () => ({ ids: ['linkedin-organic-v1'], rectangles: f.rectangles });
    (service as any).invoke = async () => ({ choices: [{ message: { parsed: f.direction } }] });
    await run(f, service, dir, { work: dir });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
it('uses one stable metered operation/fingerprint and recovers cached direction without a second provider call', async () => {
  const seen = new Map<string, any>(); let calls = 0;
  const metered = { run: async (org: string, key: string, fingerprint: string, request: any, allowed: boolean, invoke: any) => {
    assert.equal(org, 'owner'); assert.equal(allowed, true); assert.match(key, /^guided-text:[a-f0-9-]{36}:studio_direction_0$/);
    assert.equal(request.model, 'gpt-6-luna'); assert.equal(request.messages.every((m: any) => typeof m.content === 'string'), true);
    if (seen.has(key)) { assert.equal(seen.get(key).fingerprint, fingerprint); return seen.get(key).value; }
    calls++; const value = await invoke({}); seen.set(key, { fingerprint, value }); return value;
  } };
  await withProducer(async (f, service, dir, c) => {
    const first = await service.produce(c, f.job, f.raw, f.assets, dir), second = await service.produce(c, f.job, f.raw, f.assets, dir);
    assert.equal(studioFingerprint(first), studioFingerprint(second)); assert.equal(calls, 1);
    assert.equal(JSON.parse(await readFile(join(dir, 'authored-plan.json'), 'utf8')).manifest.project.id, f.job.id);
  }, metered);
});
it.each(['insufficient balance', 'disabled/revoked entitlement', 'UNKNOWN response pending reconciliation'])('has no unmetered fallback after %s', async reason => {
  let invoked = false;
  await withProducer(async (f, service, _dir, c) => {
    (service as any).invoke = async () => { invoked = true; throw Error('Must not call'); };
    await assert.rejects(service.produce(c, f.job, f.raw, f.assets, c.work), new RegExp(reason.split(' ')[0]));
    assert.equal(invoked, false);
  }, { run: async () => { throw Error(reason); } });
});
it('fails invalid evidence and missing local prerequisites before metering', async () => {
  let charged = false;
  await withProducer(async (f, service, dir, c) => {
    f.raw.files.words.value[0].start = undefined; await assert.rejects(service.produce(c, f.job, f.raw, f.assets, dir));
    delete f.raw.files.words.value[0].start; await assert.rejects(service.produce(c, f.job, f.raw, f.assets, dir)); assert.equal(charged, false);
  }, { run: async () => { charged = true; throw Error('Must not meter'); } });
});
