import { execFile } from 'child_process';
import { mkdir, readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { validateStudioEvidence } from './studio-evidence';
import { studioFingerprint } from './studio-receipt';
import { StudioRuntime, studioHashFile, studioJson } from './studio-worker';

export const ACCEPTED_EDITOR_STYLE = 'accepted-caption-b-top-rounded-v1';
export const ACCEPTED_FONT_HASHES = {
  caption: '3973aa5054fb467dd5627245d3dc82e37bf16fe075756156a570455871351582',
  headline: 'f6da258a8664b99d1a5a071cc7aebedd06e4acae6e97b8f18df7af640089636f',
};
const execute = promisify(execFile);
// Quiet-gap proposals are from the existing source/VAD policy, never from a
// language model. Continuous raw word intervals veto every proposed deletion.
export function acceptedTimeline(raw: any, expected: { organizationId: string; mediaId: string }, samples: number, restore = false) {
  const original = validateStudioEvidence(raw, expected, true);
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > (original.totalFrames + 1) * 1600) throw Error('Needs adjustment: unsupported source audio tail');
  const totalFrames = Math.max(original.totalFrames, Math.ceil(samples / 1600));
  const words = original.sourceWords;
  const gaps = raw.files.policy.value.gaps ?? [];
  if (!Array.isArray(gaps) || gaps.length > 1000) throw Error('Invalid source quiet-gap evidence');
  const removals: number[][] = [];
  if (!restore) for (const gap of gaps) {
    if (!Array.isArray(gap) || gap.length !== 2 || !gap.every(Number.isFinite) || gap[0] < 0 || gap[1] < gap[0] || gap[1] > original.totalFrames / 30) throw Error('Invalid source quiet-gap evidence');
    const from = Math.ceil(gap[0] * 30), to = Math.floor(gap[1] * 30);
    if (to - from < 6 || from === 0 || to >= original.totalFrames || words.some(w => w.start < to / 30 && w.end > from / 30)) continue;
    removals.push([from, to]);
  }
  removals.sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const r of removals) { const last = merged.at(-1); if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
  let cursor = 0;
  const cuts: { in: number; out: number; reason: string }[] = [];
  for (const [from, to] of merged) { if (from > cursor) cuts.push({ in: cursor, out: from, reason: 'Verified quiet gap; every source word retained' }); cursor = to; }
  if (cursor < totalFrames) cuts.push({ in: cursor, out: totalFrames, reason: restore ? 'All original source frames restored' : 'Verified quiet gap; every source word retained' });
  const projected = words.map(w => {
    let output = 0;
    for (const cut of cuts) {
      if (w.start >= cut.in / 30 && w.end <= cut.out / 30) return { ...w, start: w.start + (output - cut.in) / 30, end: w.end + (output - cut.in) / 30 };
      if (w.start < cut.out / 30 && w.end > cut.in / 30) throw Error('A cut intersects a source word');
      output += cut.out - cut.in;
    }
    throw Error('A source word would disappear');
  });
  return { ...original, totalFrames, originalFrames: original.totalFrames, sourceSamples: samples, cuts, words: projected,
    frames: cuts.reduce((n, c) => n + c.out - c.in, 0), audioSamples: cuts.reduce((n, c) => n + Math.max(0, Math.min(samples, c.out * 1600) - c.in * 1600), 0) };
}
// Exclusive admission and a final hash-bound receipt prevent a retry from
// overwriting or accepting a partially decoded/concatenated take.
export async function prepareAcceptedTimeline(config: StudioRuntime, row: any, raw: any, source: { path: string; sha256: string }, dir: string) {
  const work = join(dir, 'accepted-audio'), binding = studioFingerprint({ input: row.inputFingerprint, raw, source: source.sha256 });
  try { await mkdir(work, { mode: 0o700 }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const saved = await studioJson(join(work, 'receipt.json'));
    if (saved.binding !== binding || saved.audio.path !== join(work, 'speech.wav') || studioFingerprint(saved.evidence) !== studioFingerprint(acceptedTimeline(raw, { organizationId: row.organizationId, mediaId: row.sourceMediaId }, saved.evidence.sourceSamples, row.input.request.creative?.restoreCuts === true)) || await studioHashFile(saved.audio.path) !== saved.audio.sha256 || await studioHashFile(source.path) !== source.sha256) throw Error('Accepted audio changed during recovery');
    return saved as { binding: string; evidence: ReturnType<typeof acceptedTimeline>; audio: { path: string; sha256: string } };
  }
  await writeFile(join(work, 'intent.json'), JSON.stringify({ binding }), { flag: 'wx', mode: 0o600 });
  if (await studioHashFile(source.path) !== source.sha256) throw Error('Original source changed');
  const runtime = await studioJson(config.file), decoded = join(work, 'original.s32');
  const run = (args: string[]) => execute(runtime.ffmpegExecutable, ['-nostdin', '-v', 'error', '-n', '-threads', '2', '-protocol_whitelist', 'file,pipe', ...args], { timeout: 120_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH } });
  await run(['-i', source.path, '-map', '0:a:0', '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s32le', '-f', 's32le', '-fs', String(24 * 1024 * 1024), decoded]);
  const bytes = (await stat(decoded)).size;
  if (bytes < 8 || bytes >= 24 * 1024 * 1024 || bytes % 8) throw Error('Unsupported decoded audio');
  const evidence = acceptedTimeline(raw, { organizationId: row.organizationId, mediaId: row.sourceMediaId }, bytes / 8, row.input.request.creative?.restoreCuts === true);
  const pcm = await readFile(decoded), pieces = evidence.cuts.map(c => pcm.subarray(c.in * 1600 * 8, Math.min(pcm.length, c.out * 1600 * 8)));
  const retained = join(work, 'retained.s32'), path = join(work, 'speech.wav');
  await writeFile(retained, Buffer.concat(pieces), { flag: 'wx', mode: 0o600 });
  await run(['-f', 's32le', '-ar', '48000', '-ac', '2', '-i', retained, '-c:a', 'pcm_s32le', path]);
  if (await studioHashFile(source.path) !== source.sha256) throw Error('Original source changed while preparing audio');
  const result = { binding, evidence, audio: { path, sha256: await studioHashFile(path) } };
  await writeFile(join(work, 'receipt.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
  return result;
}
