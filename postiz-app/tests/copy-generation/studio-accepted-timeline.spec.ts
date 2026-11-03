import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { acceptedTimeline, prepareAcceptedTimeline } from '../../libraries/nestjs-libraries/src/media-editing/studio-accepted-timeline';

function evidence(total = 180, spans = [[.8, 1.2], [3.5, 4]]) {
  const words = spans.map(([start, end], i) => ({ text: 'word' + i, type: 'word', start, end }));
  const file = (value: any) => ({ value, sha256: 'b'.repeat(64) });
  return { schemaVersion: 1, organizationId: 'org', mediaId: 'source', jobId: randomUUID(), revision: 0,
    sourceSha256: 'a'.repeat(64), fps: 30, totalFrames: total, width: 360, height: 640, audio: { sha256: 'b'.repeat(64), bytes: 10 }, files: {
      rawWords: file(words), words: file(words), decisions: file([{ start: 0, end: total / 30 }]),
      policy: file({ version: 'quiet-block-v1', fps: 30, total, sourceSha256: 'a'.repeat(64), gaps: [[2, 3]] }),
      report: file({ policy: 'quiet-block-v1', fps: 30, final_s: total / 30, frames: [[0, total]] }),
    } };
}
it('maps quiet cuts on source frames and restores every original ID and timestamp', () => {
  const raw = evidence(), edited = acceptedTimeline(raw, { organizationId: 'org', mediaId: 'source' }, 180 * 1600);
  assert.deepEqual(edited.cuts.map(c => [c.in, c.out]), [[0, 60], [90, 180]]);
  assert.equal(edited.frames, 150); assert.equal(edited.audioSamples, 150 * 1600);
  assert.deepEqual(edited.words, [{ id: 'w0', text: 'word0', start: .8, end: 1.2 }, { id: 'w1', text: 'word1', start: 2.5, end: 3 }]);
  const restored = acceptedTimeline(raw, { organizationId: 'org', mediaId: 'source' }, 180 * 1600, true);
  assert.deepEqual(restored.cuts.map(c => [c.in, c.out]), [[0, 180]]);
  assert.equal(restored.audioSamples, 180 * 1600); assert.deepEqual(restored.words.map(({ id, ...w }) => w), raw.files.rawWords.value.map(({ type, ...w }) => w));
  assert.deepEqual(restored.words.map(w => w.id), edited.words.map(w => w.id));
});
it('vetoes cuts touching speech, keeps adjacent endpoints and rejects malformed gaps', () => {
  const raw = evidence(); raw.files.policy.value.gaps = [[1, 2]];
  assert.equal(acceptedTimeline(raw, { organizationId: 'org', mediaId: 'source' }, 180 * 1600).cuts.length, 1);
  raw.files.policy.value.gaps = [[1.2, 3.5]];
  const result = acceptedTimeline(raw, { organizationId: 'org', mediaId: 'source' }, 180 * 1600);
  assert.equal(result.words.length, 2); assert.equal(result.cuts.length, 2);
  for (const gap of [[-1, 2], [2, 7], [3, 2], [NaN, 2]]) {
    raw.files.policy.value.gaps = [gap]; assert.throws(() => acceptedTimeline(raw, { organizationId: 'org', mediaId: 'source' }, 180 * 1600));
  }
});
it.each([[1790, [[456, 471]], 1775, 2839230], [1340, [[945, 990]], 1295, 2071226], [1326, [[658, 664]], 1320, 2111334]])('preserves the explicit held-tail PCM accounting for fixture %s', (normalized, removed, output, samples) => {
  const raw = evidence(normalized - 1, [[.1, .3]]);
  raw.files.policy.value.gaps = removed.map(([a, b]) => [a / 30, b / 30]);
  const fullSamples = samples + removed.reduce((n, [a, b]) => n + (b - a) * 1600, 0);
  const plan = acceptedTimeline(raw, { organizationId: 'org', mediaId: 'source' }, fullSamples);
  assert.equal(plan.totalFrames, normalized); assert.equal(plan.originalFrames, normalized - 1);
  assert.equal(plan.frames, output); assert.equal(plan.audioSamples, samples);
  assert.equal(acceptedTimeline(raw, { organizationId: 'org', mediaId: 'source' }, fullSamples, true).audioSamples, fullSamples);
});
it('real decoded PCM is concatenated without gain, fades or truncation; replay refuses tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-approved-audio-'));
  try {
    const source = join(dir, 'source.wav'), pcm = Buffer.alloc(6 * 48000 * 8);
    for (let sample = 0; sample < pcm.length / 4; sample++) pcm.writeInt32LE(Math.round(Math.sin(sample * .031) * 1e8), sample * 4);
    const original = join(dir, 'source.s32'); await writeFile(original, pcm);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 's32le', '-ar', '48000', '-ac', '2', '-i', original, '-c:a', 'pcm_s32le', source]);
    const sha256 = createHash('sha256').update(await readFile(source)).digest('hex'), raw = evidence();
    raw.sourceSha256 = sha256; raw.files.policy.value.sourceSha256 = sha256;
    const runtime = join(dir, 'runtime.json'); await writeFile(runtime, JSON.stringify({ ffmpegExecutable: '/usr/bin/ffmpeg' }));
    const config = { file: runtime } as any, row = { organizationId: 'org', sourceMediaId: 'source', inputFingerprint: 'frozen', input: { request: { creative: {} } } };
    const result = await prepareAcceptedTimeline(config, row, raw, { path: source, sha256 }, dir);
    const decode = (path: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s32le', '-f', 's32le', '-'], { maxBuffer: 5 * 1024 * 1024 });
    assert.deepEqual(decode(result.audio.path), Buffer.concat([pcm.subarray(0, 60 * 1600 * 8), pcm.subarray(90 * 1600 * 8)]));
    assert.deepEqual(await prepareAcceptedTimeline(config, row, raw, { path: source, sha256 }, dir), result);
    await writeFile(result.audio.path, 'tampered'); await assert.rejects(prepareAcceptedTimeline(config, row, raw, { path: source, sha256 }, dir), /changed/);
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), sha256);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
