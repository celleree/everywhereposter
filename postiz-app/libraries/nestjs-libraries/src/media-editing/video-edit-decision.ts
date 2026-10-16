export const VIDEO_EDIT_DECISION_SCHEMA_VERSION = 1 as const;
export const PACING_SETTINGS = {
  tight: { silenceThresholdDb: -35, minimumSilenceMs: 350, speechPaddingMs: 80 },
  balanced: { silenceThresholdDb: -35, minimumSilenceMs: 650, speechPaddingMs: 120 },
  relaxed: { silenceThresholdDb: -35, minimumSilenceMs: 1100, speechPaddingMs: 220 },
} as const;
export type PacingPreset = keyof typeof PACING_SETTINGS;
export const MAX_EDIT_SEGMENTS = 200;

export interface SourceTimeRange { sourceStartMs: number; sourceEndMs: number }
export interface VideoEditDecision extends SourceTimeRange {
  id: string;
  action: 'keep' | 'cut';
  reasons: Array<'audible_content' | 'silence' | 'dead_air'>;
}
export interface OutputTimeRange { outputStartMs: number; outputEndMs: number }
// Reserved tracks use the rendered timeline. V1 rendering rejects nonempty tracks.
export interface VideoEditTracks {
  captions: Array<OutputTimeRange & { id: string; text: string }>;
  overlays: Array<OutputTimeRange & { id: string; mediaId: string; kind: 'image' | 'video' }>;
  transitions: Array<{ afterDecisionId: string; kind: 'crossfade'; durationMs: number }>;
  overrides: Array<{ decisionId: string; action: 'keep' | 'cut' }>;
}
export interface VideoEditDecisionListV1 {
  schemaVersion: 1;
  strategy: 'talking-head-dead-air-v1';
  pacingPreset: PacingPreset;
  source: {
    mediaId: string;
    durationMs: number;
    transcription: { id: string; generation: number; alignment: 'none' } | null;
  };
  analysis: { detector: 'ffmpeg-silencedetect-v1'; silenceThresholdDb: number; minimumSilenceMs: number; speechPaddingMs: number };
  decisions: VideoEditDecision[];
  tracks: VideoEditTracks;
}
export class VideoEditDecisionError extends Error {
  constructor(public readonly code: 'INVALID_EDIT_DECISIONS' | 'NO_USEFUL_SEGMENTS' | 'TOO_MANY_SEGMENTS', message: string) {
    super(message);
  }
}
const invalid = (): never => { throw new VideoEditDecisionError('INVALID_EDIT_DECISIONS', 'Invalid or unsupported edit decisions.'); };
const clamp = (value: number, duration: number) => Math.max(0, Math.min(duration, Math.round(value)));
const normalizeRanges = (ranges: SourceTimeRange[], duration: number) => {
  const result: SourceTimeRange[] = [];
  for (const range of ranges.map((r) => {
    if (!Number.isFinite(r.sourceStartMs) || !Number.isFinite(r.sourceEndMs)) invalid();
    return { sourceStartMs: clamp(r.sourceStartMs, duration), sourceEndMs: clamp(r.sourceEndMs, duration) };
  }).filter((r) => r.sourceEndMs > r.sourceStartMs).sort((a, b) => a.sourceStartMs - b.sourceStartMs)) {
    const previous = result.at(-1);
    if (previous && range.sourceStartMs <= previous.sourceEndMs) previous.sourceEndMs = Math.max(previous.sourceEndMs, range.sourceEndMs);
    else result.push({ ...range });
  }
  return result;
};
export const parseSilenceDetectionOutput = (output: string, durationMs: number): SourceTimeRange[] => {
  const ranges: SourceTimeRange[] = [];
  let start: number | undefined;
  for (const event of output.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)) {
    const time = clamp(Number(event[2]) * 1000, durationMs);
    if (event[1] === 'start') start = time;
    else if (start !== undefined) { ranges.push({ sourceStartMs: start, sourceEndMs: time }); start = undefined; }
  }
  if (start !== undefined) ranges.push({ sourceStartMs: start, sourceEndMs: durationMs });
  return normalizeRanges(ranges, durationMs);
};

export const buildVideoEditDecisionList = (input: {
  mediaId: string; durationMs: number; pacingPreset: PacingPreset;
  transcription?: VideoEditDecisionListV1['source']['transcription'];
  detectedSilence: SourceTimeRange[];
}): VideoEditDecisionListV1 => {
  if (!Object.prototype.hasOwnProperty.call(PACING_SETTINGS, input.pacingPreset) || !input.mediaId || !Number.isInteger(input.durationMs) || input.durationMs <= 0) invalid();
  const settings = PACING_SETTINGS[input.pacingPreset];
  const cuts = normalizeRanges(input.detectedSilence, input.durationMs)
    .filter((r) => r.sourceEndMs - r.sourceStartMs >= settings.minimumSilenceMs)
    .map((r) => ({
      sourceStartMs: r.sourceStartMs === 0 ? 0 : r.sourceStartMs + settings.speechPaddingMs,
      sourceEndMs: r.sourceEndMs === input.durationMs ? input.durationMs : r.sourceEndMs - settings.speechPaddingMs,
    })).filter((r) => r.sourceEndMs > r.sourceStartMs);
  const decisions: VideoEditDecision[] = [];
  const append = (start: number, end: number, action: VideoEditDecision['action']) => decisions.push({
    id: `decision-${decisions.length + 1}`, action, sourceStartMs: start, sourceEndMs: end,
    reasons: action === 'keep' ? ['audible_content'] : ['silence', 'dead_air'],
  });
  let cursor = 0;
  for (const cut of cuts) {
    if (cursor < cut.sourceStartMs) append(cursor, cut.sourceStartMs, 'keep');
    append(cut.sourceStartMs, cut.sourceEndMs, 'cut');
    cursor = cut.sourceEndMs;
  }
  if (cursor < input.durationMs) append(cursor, input.durationMs, 'keep');
  if (!decisions.some((d) => d.action === 'keep')) throw new VideoEditDecisionError('NO_USEFUL_SEGMENTS', 'The source contains only silence.');
  if (decisions.length > MAX_EDIT_SEGMENTS) throw new VideoEditDecisionError('TOO_MANY_SEGMENTS', 'The source contains too many edit segments.');
  const result: VideoEditDecisionListV1 = {
    schemaVersion: 1, strategy: 'talking-head-dead-air-v1', pacingPreset: input.pacingPreset,
    source: { mediaId: input.mediaId, durationMs: input.durationMs, transcription: input.transcription || null },
    analysis: { detector: 'ffmpeg-silencedetect-v1', ...settings }, decisions,
    tracks: { captions: [], overlays: [], transitions: [], overrides: [] },
  };
  assertValidVideoEditDecisionList(result);
  return result;
};

export function assertValidVideoEditDecisionList(list: VideoEditDecisionListV1): void {
  if (!list || list.schemaVersion !== 1 || list.strategy !== 'talking-head-dead-air-v1' ||
      !Object.prototype.hasOwnProperty.call(PACING_SETTINGS, list.pacingPreset) || !list.source?.mediaId ||
      !Number.isInteger(list.source.durationMs) || list.source.durationMs <= 0 ||
      !Array.isArray(list.decisions) || !list.decisions.length || list.decisions.length > MAX_EDIT_SEGMENTS ||
      !list.tracks || Object.keys(list.tracks).length !== 4 ||
      ['captions', 'overlays', 'transitions', 'overrides'].some((key) => !Array.isArray(list.tracks[key as keyof VideoEditTracks]) || list.tracks[key as keyof VideoEditTracks].length)) invalid();
  const transcript = list.source.transcription;
  if (transcript !== null && (!transcript?.id || !Number.isInteger(transcript.generation) || transcript.generation <= 0 || transcript.alignment !== 'none')) invalid();
  const settings = PACING_SETTINGS[list.pacingPreset];
  if (list.analysis?.detector !== 'ffmpeg-silencedetect-v1' ||
      list.analysis.silenceThresholdDb !== settings.silenceThresholdDb ||
      list.analysis.minimumSilenceMs !== settings.minimumSilenceMs || list.analysis.speechPaddingMs !== settings.speechPaddingMs) invalid();
  let cursor = 0;
  const ids = new Set<string>();
  for (const decision of list.decisions) {
    if (!decision?.id || ids.has(decision.id) || !['keep', 'cut'].includes(decision.action) ||
        !Number.isInteger(decision.sourceStartMs) || !Number.isInteger(decision.sourceEndMs) ||
        decision.sourceStartMs !== cursor || decision.sourceEndMs <= cursor || decision.sourceEndMs > list.source.durationMs ||
        !Array.isArray(decision.reasons) || !decision.reasons.length || decision.reasons.some((r) => !['audible_content', 'silence', 'dead_air'].includes(r))) invalid();
    ids.add(decision.id);
    cursor = decision.sourceEndMs;
  }
  if (cursor !== list.source.durationMs || !list.decisions.some((d) => d.action === 'keep')) invalid();
}
export const getKeptDurationMs = (list: VideoEditDecisionListV1) => list.decisions.reduce((total, d) => total + (d.action === 'keep' ? d.sourceEndMs - d.sourceStartMs : 0), 0);
