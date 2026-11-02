import { createHash, randomUUID } from 'crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StudioDirectorService, studioEffectBounds } from '../../libraries/nestjs-libraries/src/media-editing/studio-director.service';
import * as worker from '../../libraries/nestjs-libraries/src/media-editing/studio-worker';

export const timingCapability = { version: 1, field: 'captionTimingPolicy', default: 'legacy-v1', policies: ['legacy-v1', 'trim-trailing-hold-v1'] };
export const capabilityScript = (v: any) => 'process.stdout.write(' + JSON.stringify(JSON.stringify(v)) + ');';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function fixture(text = 'Build systems with care') {
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
export async function withProducer(run: (f: ReturnType<typeof fixture>, service: StudioDirectorService, dir: string, config: any) => Promise<void>, metered: any) {
  const f = fixture(), dir = await mkdtemp(join(tmpdir(), 'studio-director-'));
  try {
    await writeFile(join(dir, 'Body-Bold.ttf'), Buffer.from([0, 1, 0, 0, 1])); await writeFile(join(dir, 'cooked-audio.mp4'), 'aligned-audio');
    for (const name of ['decisions', 'captions', 'receipt']) await writeFile(join(dir, 'cooked-' + name + '.json'), '{}');
    const service = new StudioDirectorService(metered, { getSubscriptionByOrganizationId: async () => ({ subscriptionTier: 'LAUNCH_V1' }) } as any);
    (service as any).geometry = async () => ({ ids: ['linkedin-organic-v1'], rectangles: f.rectangles });
    (service as any).invoke = async () => ({ choices: [{ message: { parsed: f.direction } }] });
    await writeFile(join(dir, 'run.mjs'), capabilityScript({ captionTiming: timingCapability }));
    await run(f, service, dir, { work: dir, root: dir, node: process.execPath });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export const titleCapability = { version: 1, profile: 'talking-head-v2', command: 'title-preflight', checkCommand: 'title-preflight-check', style: 'block-title-v1', fontSize: 96, titleMaxLines: 2, captionMaxLines: 2 };
export const profileCapability = { version: 1, profiles: [{ manifestSchemaVersion: 1, projectSchemaVersion: 1, profile: 'easy-graphics-v1' }, { manifestSchemaVersion: 2, projectSchemaVersion: 2, profile: 'talking-head-v2' }] };
export const allCapabilities = { captionTiming: timingCapability, profiles: profileCapability, titlePreflight: titleCapability };
export function fullSource(f: ReturnType<typeof fixture>, sentence = 'Do not change this.') {
  f.assets.splice(1); f.job.input.request.brollMediaIds = []; f.job.input.request.profile = 'talking-head-v2';
  f.direction.effects = []; f.direction.broll = [];
  Object.assign(f.framing, { x: .4, y: .6, width: .3, height: .2 });
  const words = sentence.split(' ').map((text, i) => ({ type: 'word', text, start: .1 + i * .2, end: .2 + i * .2 }));
  f.raw.files.rawWords.value = structuredClone(words); f.raw.files.words.value = structuredClone(words);
  f.raw.files.decisions.value = [{ start: 0, end: 6 }]; f.raw.files.report.value = { policy: 'quiet-block-v1', fps: 30, final_s: 6, frames: [[0, 180]] };
}
export async function withV2Producer(run: Parameters<typeof withProducer>[0], metered: any, real = false) {
  const previous = process.env.STUDIO_EDITOR_V2_ENABLED; process.env.STUDIO_EDITOR_V2_ENABLED = 'true';
  const command = real ? undefined : jest.spyOn(worker, 'studioCommand').mockImplementation(async (_c, kind, args) => {
    if (kind === 'capabilities') return JSON.stringify(allCapabilities);
    if (kind === 'title-preflight') await writeFile(join(args[0], 'title-preflight.json'), '{}', { flag: 'wx' });
    if (kind === 'title-preflight-check') await readFile(join(args[0], 'title-preflight.json'));
    return '{}';
  });
  try { await withProducer(async (f, service, dir, config) => {
    fullSource(f); await writeFile(join(dir, 'run.mjs'), capabilityScript(allCapabilities));
    await run(f, service, dir, config);
  }, metered); }
  finally { command?.mockRestore(); if (previous === undefined) delete process.env.STUDIO_EDITOR_V2_ENABLED; else process.env.STUDIO_EDITOR_V2_ENABLED = previous; }
}
