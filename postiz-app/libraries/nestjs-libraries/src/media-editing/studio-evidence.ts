// Cooked-native facts only. Text directing cannot supply timestamps or framing.
export type StudioFraming = { x: number; y: number; width: number; height: number;
  confirmed: true; stationary: true; singleSpeaker: true; sourceSha256?: string };
export const validStudioHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const fail = (): never => { throw Error('Studio needs complete current source-clock evidence'); };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function validateStudioFraming(v: any): StudioFraming {
  if (!v || Object.keys(v).some(k => !['x', 'y', 'width', 'height', 'confirmed', 'stationary', 'singleSpeaker', 'sourceSha256'].includes(k)) ||
      v.confirmed !== true || v.stationary !== true || v.singleSpeaker !== true ||
      !['x', 'y', 'width', 'height'].every(k => finite(v[k])) || v.x < 0 || v.y < 0 || v.width < .05 || v.height < .05 ||
      v.x + v.width > 1 || v.y + v.height > 1 || v.sourceSha256 !== undefined && !validStudioHash(v.sourceSha256)) {
    throw Error('Confirm one stationary speaker region; moving or multiple speakers need adjustment');
  }
  return { x: v.x, y: v.y, width: v.width, height: v.height, confirmed: true, stationary: true, singleSpeaker: true,
    ...(v.sourceSha256 ? { sourceSha256: v.sourceSha256 } : {}) };
}
function words(raw: any, ceiling: number) {
  if (!Array.isArray(raw) || raw.length > 6000) fail();
  let previous = -1;
  return raw.filter(w => w?.type === 'word' || w?.type === undefined).map(w => {
    // Explicit supported native spellings; never synthesize a missing time.
    const text = w.text ?? w.word;
    if (typeof text !== 'string' || !text.trim() || text.length > 100 || !finite(w.start) || !finite(w.end) ||
        w.start < 0 || w.end < w.start || w.end > ceiling + .001 || w.start < previous ||
        w.text !== undefined && w.word !== undefined && w.text !== w.word) fail();
    previous = w.start; return { text: text.trim(), start: w.start, end: w.end };
  });
}
export function validateStudioEvidence(v: any, expected: { organizationId: string; mediaId: string; sourceSha256?: string }) {
  if (!v || v.schemaVersion !== 1 || v.organizationId !== expected.organizationId || v.mediaId !== expected.mediaId ||
      !/^[a-f0-9-]{36}$/.test(v.jobId || '') || !Number.isSafeInteger(v.revision) || v.revision < 0 ||
      !validStudioHash(v.sourceSha256) || expected.sourceSha256 && v.sourceSha256 !== expected.sourceSha256 ||
      v.fps !== 30 || !Number.isSafeInteger(v.totalFrames) || v.totalFrames < 1 || v.totalFrames > 1800 ||
      !Number.isSafeInteger(v.width) || !Number.isSafeInteger(v.height) || v.width < 320 || v.width > 720 || v.height > 1280 ||
      Math.abs(v.width / v.height - 9 / 16) > .001 || !validStudioHash(v.audio?.sha256) || !Number.isSafeInteger(v.audio?.bytes) ||
      v.audio.bytes < 1 || v.audio.bytes > 100 * 1024 * 1024) fail();
  for (const k of ['rawWords', 'words', 'decisions', 'policy', 'report']) if (!validStudioHash(v.files?.[k]?.sha256)) fail();
  const policy = v.files.policy.value, report = v.files.report.value, decisions = v.files.decisions.value;
  if (policy?.sourceSha256 !== v.sourceSha256 || policy.version !== 'quiet-block-v1' || policy.fps !== v.fps || policy.total !== v.totalFrames ||
      report?.policy !== 'quiet-block-v1' || report.fps !== v.fps || !Array.isArray(report.frames) || !report.frames.length || report.frames.length > 100 ||
      !Array.isArray(decisions) || decisions.length !== report.frames.length) fail();
  let last = 0, outputFrames = 0;
  const cuts = report.frames.map((r: any, i: number) => {
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isSafeInteger) || r[0] < last || r[1] <= r[0] || r[1] > v.totalFrames ||
        !finite(decisions[i]?.start) || !finite(decisions[i]?.end) || Math.abs(decisions[i].start * 30 - r[0]) > .00001 ||
        Math.abs(decisions[i].end * 30 - r[1]) > .00001) fail();
    last = r[1]; outputFrames += r[1] - r[0]; return { in: r[0], out: r[1], reason: 'Verified Cooked source-frame timeline' };
  });
  if (!finite(report.final_s) || Math.abs(report.final_s - outputFrames / 30) > .001) fail();
  const rawWords = words(v.files.rawWords.value, v.totalFrames / 30), outputWords = words(v.files.words.value, outputFrames / 30);
  const retained: { id: string; text: string; start: number; end: number }[] = [];
  for (const w of rawWords) {
    let cursor = 0, included = false;
    for (const cut of cuts) {
      const start = cut.in / 30, end = cut.out / 30;
      if (w.start >= start - .00001 && w.end <= end + .00001) {
        retained.push({ id: 'w' + retained.length, text: w.text, start: cursor + w.start - start, end: cursor + w.end - start }); included = true; break;
      }
      // Whole-word preservation: refuse a native cut that intersects speech.
      if (w.start < end && w.end > start) fail();
      cursor += end - start;
    }
    if (!included && cuts.some((c: any) => w.start < c.out / 30 && w.end > c.in / 30)) fail();
  }
  if (!retained.length || retained.length > 2000 || retained.length !== outputWords.length || retained.some((w, i) => w.text !== outputWords[i].text ||
      Math.abs(w.start - outputWords[i].start) > .001 || Math.abs(w.end - outputWords[i].end) > .001)) fail();
  // Keep the native output timestamps, not rounded or model-reconstructed ones.
  return { sourceSha256: v.sourceSha256 as string, revision: v.revision as number, frames: outputFrames,
    totalFrames: v.totalFrames as number, fps: 30 as const, width: v.width as number, height: v.height as number, cuts,
    words: outputWords.map((w, i) => ({ id: 'w' + i, ...w })), audio: v.audio as { sha256: string; bytes: number } };
}
