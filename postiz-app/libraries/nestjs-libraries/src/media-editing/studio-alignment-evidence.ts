import { validateStudioEvidence } from './studio-evidence';
import { alignmentHash, AlignmentIdentity, createSourceMap, FrameRange } from './studio-source-clock';

// Observations are labeled by clock domain; absence is unknown, never an inferred rate.
export type AudioClockObservation = { domain: 'source' | 'decoded' | 'output'; sampleRate?: number; origin?: 'known-zero' | 'unknown' };
export type AlignmentObservations = { source?: AudioClockObservation; decoded?: AudioClockObservation; output?: AudioClockObservation };
const fail = (): never => { throw Error('Invalid alignment evidence'); };

export function studioAlignmentEvidence(
  evidence: any, expected: { organizationId: string; mediaId: string; sourceSha256?: string },
  identity?: AlignmentIdentity, observations: AlignmentObservations = {}
) {
  const validated = validateStudioEvidence(evidence, expected);
  const clocks = {} as Record<'source' | 'decoded' | 'output', { sampleRate: number | null; origin: 'known-zero' | 'unknown' }>;
  for (const domain of ['source', 'decoded', 'output'] as const) {
    const clock = observations[domain];
    if (clock && (clock.domain !== domain || clock.sampleRate !== undefined &&
        (!Number.isSafeInteger(clock.sampleRate) || clock.sampleRate <= 0) ||
        clock.origin !== undefined && clock.origin !== 'known-zero' && clock.origin !== 'unknown')) fail();
    clocks[domain] = { sampleRate: clock?.sampleRate ?? null, origin: clock?.origin ?? 'unknown' };
  }
  const normalize = (raw: any[], ceiling: number) => {
    let previousEnd = 0;
    return raw.filter(w => w?.type === 'word' || w?.type === undefined).map((w, ordinal) => {
      if (!w || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end <= w.start || w.start < previousEnd || w.end > ceiling) fail();
      previousEnd = w.end;
      return { ordinal, text: (w.text ?? w.word).trim(), start: w.start, end: w.end };
    });
  };
  const raw = normalize(evidence.files.rawWords.value, validated.totalFrames / 30);
  const output = normalize(evidence.files.words.value, validated.frames / 30);
  const ranges: FrameRange[] = validated.cuts.map(c => [c.in, c.out]);
  // Compare the whole-word projection in both identity states, allowing only binary64 arithmetic error.
  const projected: { text: string; start: number; end: number }[] = [];
  for (const word of raw) {
    let cursor = 0;
    for (const [start, end] of ranges) {
      const lo = start / 30, hi = end / 30;
      if (word.start >= lo && word.end <= hi) {
        projected.push({ text: word.text, start: cursor / 30 + (word.start - lo), end: cursor / 30 + (word.end - lo) });
        break;
      }
      if (word.start < hi && word.end > lo) fail();
      cursor += end - start;
    }
  }
  const sameTime = (a: number, b: number) => Math.abs(a - b) <= Number.EPSILON * 8 * Math.max(1, validated.totalFrames / 30);
  if (projected.length !== output.length || projected.some((w, i) => w.text !== output[i].text ||
      !sameTime(w.start, output[i].start) || !sameTime(w.end, output[i].end))) fail();
  const mapFor = (alignment: string) => createSourceMap(validated.sourceSha256, alignment, validated.totalFrames, ranges);
  let snapshot: { alignmentHash: string; mapHash: string; words: ReturnType<ReturnType<typeof createSourceMap>['projectWords']> } | null = null;
  if (identity !== undefined) {
    const hash = alignmentHash(identity);
    if (identity.sourceSha256 !== validated.sourceSha256 || identity.rawAlignmentBytesSha256 !== evidence.files.rawWords.sha256 ||
        clocks.source.sampleRate !== null && clocks.source.sampleRate !== identity.clock.audioSampleRate ||
        clocks.source.origin !== 'unknown' && clocks.source.origin !== identity.clock.origin) fail();
    const map = mapFor(hash);
    snapshot = { alignmentHash: hash, mapHash: map.mapHash, words: map.projectWords(raw) };
  }
  return { mechanicallyValid: true as const, identityStatus: identity ? 'constructible' as const : 'incomplete' as const,
    snapshot, clocks, missingEvidence: [
      ...(!identity ? ['alignment identity and original source sample rate'] : []),
      ...(clocks.decoded.sampleRate === null ? ['decoded sample rate'] : []),
      ...(clocks.output.sampleRate === null ? ['output sample rate'] : []),
      'trusted provenance', 'speech coverage', 'per-job semantic eligibility', 'human verification',
    ], speechCoverageChecked: false as const, semanticCutsEligible: false as const, humanVerified: false as const };
}
