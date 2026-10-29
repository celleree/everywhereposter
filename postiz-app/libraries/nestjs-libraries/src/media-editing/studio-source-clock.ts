import { createHash } from 'crypto';

// This contract validates supplied identities; it does not establish their provenance.
export type SourceClock = { fpsNumerator: number; fpsDenominator: number; audioSampleRate: number; origin: string };
export type AlignmentIdentity = { sourceSha256: string; rawAlignmentBytesSha256: string; engineName: string;
  engineVersion: string; modelArtifactSha256: string; language: string; canonicalOptionsSha256: string; clock: SourceClock };
export type FrameRange = [number, number];
export type SourceWord = { ordinal: number; text: string; start: number; end: number };
const fail = (): never => { throw Error('Invalid source clock evidence'); };
const hash = (tuple: unknown[]) => createHash('sha256').update(JSON.stringify(tuple), 'utf8').digest('hex');
const validHash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const validString = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 256;
const ordinal = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const totalValid = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 1800;

export function alignmentHash(v: AlignmentIdentity): string {
  if (!v || !validHash(v.sourceSha256) || !validHash(v.rawAlignmentBytesSha256) || !validHash(v.modelArtifactSha256) ||
      !validHash(v.canonicalOptionsSha256) || !validString(v.engineName) || !validString(v.engineVersion) || !validString(v.language) ||
      !v.clock || v.clock.fpsNumerator !== 30 || v.clock.fpsDenominator !== 1 || v.clock.origin !== 'known-zero' ||
      !Number.isSafeInteger(v.clock.audioSampleRate) || v.clock.audioSampleRate <= 0) fail();
  return hash(['ep-alignment-v1', v.sourceSha256, v.rawAlignmentBytesSha256, v.engineName, v.engineVersion,
    v.modelArtifactSha256, v.language, v.canonicalOptionsSha256, [30, 1, v.clock.audioSampleRate, 'known-zero']]);
}
export function sourceWordId(sourceSha256: string, alignment: string, wordOrdinal: number): string {
  if (!validHash(sourceSha256) || !validHash(alignment) || !ordinal(wordOrdinal)) fail();
  return hash(['ep-source-word-v1', sourceSha256, alignment, wordOrdinal]);
}
function seconds(start: number, end: number, totalFrames: number) {
  if (!totalValid(totalFrames) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > totalFrames / 30) fail();
}
function derive(start: number, end: number, totalFrames: number, interior: boolean): FrameRange {
  seconds(start, end, totalFrames);
  const range: FrameRange = interior ? [Math.ceil(start * 30), Math.floor(end * 30)] : [Math.floor(start * 30), Math.ceil(end * 30)];
  if (range[0] < 0 || range[1] > totalFrames || range[0] >= range[1]) fail();
  return range;
}
export const coveringFrames = (start: number, end: number, totalFrames: number): FrameRange => derive(start, end, totalFrames, false);
export const removableInteriorFrames = (start: number, end: number, totalFrames: number): FrameRange => derive(start, end, totalFrames, true);

export function createSourceMap(sourceSha256: string, alignment: string, totalFrames: number, keptRanges: FrameRange[]) {
  if (!validHash(sourceSha256) || !validHash(alignment) || !totalValid(totalFrames) || !Array.isArray(keptRanges) || !keptRanges.length) fail();
  let previous = 0, outputFrames = 0;
  const ranges = keptRanges.map(r => {
    if (!Array.isArray(r) || r.length !== 2 || !Number.isSafeInteger(r[0]) || !Number.isSafeInteger(r[1]) ||
        r[0] < previous || r[1] <= r[0] || r[1] > totalFrames) fail();
    previous = r[1]; outputFrames += r[1] - r[0]; return [r[0], r[1]] as FrameRange;
  });
  const mapHash = hash(['ep-source-map-v1', sourceSha256, alignment, 30, totalFrames, ranges]);
  function forward(frame: number): number | null {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame > totalFrames) fail();
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (frame >= start && frame < end) return cursor + frame - start;
      cursor += end - start;
    }
    return null;
  }
  function inverse(frame: number): number | null {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame > outputFrames) fail();
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (frame >= cursor && frame < cursor + end - start) return start + frame - cursor;
      cursor += end - start;
    }
    return null;
  }
  function projectWords(words: SourceWord[]) {
    if (!Array.isArray(words)) fail();
    let previousEnd = 0, previousOrdinal = -1;
    return words.flatMap(word => {
      if (!word || !ordinal(word.ordinal) || word.ordinal <= previousOrdinal || !validString(word.text)) fail();
      seconds(word.start, word.end, totalFrames);
      if (word.start < previousEnd) fail();
      previousEnd = word.end; previousOrdinal = word.ordinal;
      let cursor = 0;
      for (const [start, end] of ranges) {
        const lo = start / 30, hi = end / 30;
        if (word.start >= lo && word.end <= hi) return [{ ...word, id: sourceWordId(sourceSha256, alignment, word.ordinal),
          start: cursor / 30 + (word.start - lo), end: cursor / 30 + (word.end - lo) }];
        if (word.start < hi && word.end > lo) fail();
        cursor += end - start;
      }
      return [];
    });
  }
  return { mapHash, outputFrames, forward, inverse, projectWords };
}
