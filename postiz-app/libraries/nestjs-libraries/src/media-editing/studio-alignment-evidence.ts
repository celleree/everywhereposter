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
  const normalize = (raw: any[]) => {
    let previousEnd = 0;
    return raw.filter(w => w?.type === 'word' || w?.type === undefined).map((w, ordinal) => {
      if (!w || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end <= w.start || w.start < previousEnd) fail();
      previousEnd = w.end;
      return { ordinal, text: (w.text ?? w.word).trim(), start: w.start, end: w.end };
    });
  };
  const raw = normalize(evidence.files.rawWords.value);
  normalize(evidence.files.words.value);
  const ranges: FrameRange[] = validated.cuts.map(c => [c.in, c.out]);
  // Require strict whole-word containment even when identity is unavailable.
  for (const word of raw) {
    for (const [start, end] of ranges) {
      const lo = start / 30, hi = end / 30;
      if (word.start < hi && word.end > lo && !(word.start >= lo && word.end <= hi)) fail();
    }
  }
  const mapFor = (alignment: string) => createSourceMap(validated.sourceSha256, alignment, validated.totalFrames, ranges);
  let snapshot: { alignmentHash: string; mapHash: string; words: ReturnType<ReturnType<typeof createSourceMap>['projectWords']> } | null = null;
  if (identity !== undefined) {
    const hash = alignmentHash(identity);
    if (identity.sourceSha256 !== validated.sourceSha256 || identity.rawAlignmentBytesSha256 !== evidence.files.rawWords.sha256 ||
        clocks.source.sampleRate !== null && clocks.source.sampleRate !== identity.clock.audioSampleRate ||
        clocks.source.origin !== 'unknown' && clocks.source.origin !== identity.clock.origin) fail();
    const map = mapFor(hash);
    const projected = map.projectWords(raw);
    if (projected.length !== validated.words.length || projected.some((w, i) => w.text !== validated.words[i].text ||
        Math.abs(w.start - validated.words[i].start) > .001 || Math.abs(w.end - validated.words[i].end) > .001)) fail();
    snapshot = { alignmentHash: hash, mapHash: map.mapHash, words: projected };
  }
  return { mechanicallyValid: true as const, identityStatus: identity ? 'constructible' as const : 'incomplete' as const,
    snapshot, clocks, missingEvidence: [
      ...(!identity ? ['alignment identity and original source sample rate'] : []),
      ...(clocks.decoded.sampleRate === null ? ['decoded sample rate'] : []),
      ...(clocks.output.sampleRate === null ? ['output sample rate'] : []),
      'trusted provenance', 'speech coverage', 'per-job semantic eligibility', 'human verification',
    ], speechCoverageChecked: false as const, semanticCutsEligible: false as const, humanVerified: false as const };
}
