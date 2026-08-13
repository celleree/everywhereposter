import {
  isValidTalkingHeadStyleMetadata,
  TalkingHeadStyleMetadata,
} from '@gitroom/nestjs-libraries/media-editing/talking-head-style';

export const VIDEO_EDIT_DECISION_SCHEMA_VERSION = 1 as const;

export type VideoEditAction = 'keep' | 'cut';
export type VideoEditReason = 'audible_content' | 'silence' | 'dead_air';

export interface SourceTimeRange {
  sourceStartMs: number;
  sourceEndMs: number;
}

export interface VideoEditDecision extends SourceTimeRange {
  id: string;
  action: VideoEditAction;
  reasons: VideoEditReason[];
}

export interface VideoEditDecisionListV1 {
  schemaVersion: typeof VIDEO_EDIT_DECISION_SCHEMA_VERSION;
  strategy: 'talking-head-dead-air-v1';
  style: TalkingHeadStyleMetadata;
  source: {
    mediaId: string;
    durationMs: number;
    transcription: {
      id: string;
      generation: number;
      alignment: 'none';
      characterCount: number;
      wordCount: number;
      semanticSelectionApplied: false;
    };
  };
  analysis: {
    detector: 'ffmpeg-silencedetect-v1';
    silenceThresholdDb: number;
    minimumSilenceMs: number;
    speechPaddingMs: number;
  };
  decisions: VideoEditDecision[];
}

export interface BuildVideoEditDecisionListInput {
  mediaId: string;
  durationMs: number;
  style: TalkingHeadStyleMetadata;
  transcription: {
    id: string;
    generation: number;
    text: string;
  };
  detectedSilence: SourceTimeRange[];
  silenceThresholdDb: number;
  minimumSilenceMs: number;
  speechPaddingMs: number;
  maxKeepRanges: number;
}

export class VideoEditDecisionError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_EDIT_DECISIONS'
      | 'NO_USEFUL_SEGMENTS'
      | 'TOO_MANY_SEGMENTS',
    message: string
  ) {
    super(message);
    this.name = 'VideoEditDecisionError';
  }
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const normalizeRanges = (
  ranges: SourceTimeRange[],
  durationMs: number
): SourceTimeRange[] => {
  const normalized = ranges
    .flatMap((range) => {
      const sourceStartMs = Math.round(
        clamp(range.sourceStartMs, 0, durationMs)
      );
      const sourceEndMs = Math.round(clamp(range.sourceEndMs, 0, durationMs));

      return sourceEndMs > sourceStartMs
        ? [{ sourceStartMs, sourceEndMs }]
        : [];
    })
    .sort(
      (first, second) =>
        first.sourceStartMs - second.sourceStartMs ||
        first.sourceEndMs - second.sourceEndMs
    );

  return normalized.reduce<SourceTimeRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (!previous || range.sourceStartMs > previous.sourceEndMs) {
      merged.push({ ...range });
      return merged;
    }

    previous.sourceEndMs = Math.max(previous.sourceEndMs, range.sourceEndMs);
    return merged;
  }, []);
};

export const parseSilenceDetectionOutput = (
  output: string,
  durationMs: number
): SourceTimeRange[] => {
  const ranges: SourceTimeRange[] = [];
  const eventPattern = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;
  let currentStartMs: number | undefined;

  for (const match of output.matchAll(eventPattern)) {
    const valueMs = Math.round(Number.parseFloat(match[2]) * 1000);
    if (!Number.isFinite(valueMs)) {
      continue;
    }

    if (match[1] === 'start') {
      currentStartMs = clamp(valueMs, 0, durationMs);
      continue;
    }

    if (currentStartMs === undefined) {
      continue;
    }

    ranges.push({
      sourceStartMs: currentStartMs,
      sourceEndMs: clamp(valueMs, 0, durationMs),
    });
    currentStartMs = undefined;
  }

  if (currentStartMs !== undefined && currentStartMs < durationMs) {
    ranges.push({
      sourceStartMs: currentStartMs,
      sourceEndMs: durationMs,
    });
  }

  return normalizeRanges(ranges, durationMs);
};

const countWords = (text: string) => {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).length : 0;
};

const buildCutRanges = (
  detectedSilence: SourceTimeRange[],
  durationMs: number,
  minimumSilenceMs: number,
  speechPaddingMs: number
) =>
  normalizeRanges(detectedSilence, durationMs)
    .filter(
      (range) => range.sourceEndMs - range.sourceStartMs >= minimumSilenceMs
    )
    .flatMap((range): SourceTimeRange[] => {
      const startsAtBeginning = range.sourceStartMs === 0;
      const endsAtEnd = range.sourceEndMs === durationMs;
      const sourceStartMs = startsAtBeginning
        ? 0
        : range.sourceStartMs + speechPaddingMs;
      const sourceEndMs = endsAtEnd
        ? durationMs
        : range.sourceEndMs - speechPaddingMs;

      return sourceEndMs > sourceStartMs
        ? [{ sourceStartMs, sourceEndMs }]
        : [];
    });

export const buildVideoEditDecisionList = (
  input: BuildVideoEditDecisionListInput
): VideoEditDecisionListV1 => {
  if (
    !input.mediaId ||
    !isValidTalkingHeadStyleMetadata(input.style) ||
    !input.transcription.id ||
    !Number.isInteger(input.durationMs) ||
    input.durationMs <= 0 ||
    !Number.isInteger(input.transcription.generation) ||
    input.transcription.generation <= 0 ||
    !Number.isFinite(input.silenceThresholdDb) ||
    !Number.isInteger(input.minimumSilenceMs) ||
    input.minimumSilenceMs <= 0 ||
    !Number.isInteger(input.speechPaddingMs) ||
    input.speechPaddingMs < 0 ||
    !Number.isInteger(input.maxKeepRanges) ||
    input.maxKeepRanges <= 0
  ) {
    throw new VideoEditDecisionError(
      'INVALID_EDIT_DECISIONS',
      'The edit-decision input is invalid.'
    );
  }

  const cutRanges = normalizeRanges(
    buildCutRanges(
      input.detectedSilence,
      input.durationMs,
      input.minimumSilenceMs,
      input.speechPaddingMs
    ),
    input.durationMs
  );
  const decisions: VideoEditDecision[] = [];
  let cursorMs = 0;

  for (const cut of cutRanges) {
    if (cursorMs < cut.sourceStartMs) {
      decisions.push({
        id: '',
        action: 'keep',
        sourceStartMs: cursorMs,
        sourceEndMs: cut.sourceStartMs,
        reasons: ['audible_content'],
      });
    }

    decisions.push({
      id: '',
      action: 'cut',
      sourceStartMs: cut.sourceStartMs,
      sourceEndMs: cut.sourceEndMs,
      reasons: ['silence', 'dead_air'],
    });
    cursorMs = cut.sourceEndMs;
  }

  if (cursorMs < input.durationMs) {
    decisions.push({
      id: '',
      action: 'keep',
      sourceStartMs: cursorMs,
      sourceEndMs: input.durationMs,
      reasons: ['audible_content'],
    });
  }

  const keepCount = decisions.filter(
    (decision) => decision.action === 'keep'
  ).length;
  if (!keepCount) {
    throw new VideoEditDecisionError(
      'NO_USEFUL_SEGMENTS',
      'No speech-bearing segments were found in this video.'
    );
  }
  if (keepCount > input.maxKeepRanges) {
    throw new VideoEditDecisionError(
      'TOO_MANY_SEGMENTS',
      'The video contains too many edit segments for the Phase 1 renderer.'
    );
  }

  const decisionList: VideoEditDecisionListV1 = {
    schemaVersion: VIDEO_EDIT_DECISION_SCHEMA_VERSION,
    strategy: 'talking-head-dead-air-v1',
    style: {
      ...input.style,
      warnings: [...input.style.warnings],
    },
    source: {
      mediaId: input.mediaId,
      durationMs: input.durationMs,
      transcription: {
        id: input.transcription.id,
        generation: input.transcription.generation,
        alignment: 'none',
        characterCount: input.transcription.text.length,
        wordCount: countWords(input.transcription.text),
        semanticSelectionApplied: false,
      },
    },
    analysis: {
      detector: 'ffmpeg-silencedetect-v1',
      silenceThresholdDb: input.silenceThresholdDb,
      minimumSilenceMs: input.minimumSilenceMs,
      speechPaddingMs: input.speechPaddingMs,
    },
    decisions: decisions.map((decision, index) => ({
      ...decision,
      id: 'decision-' + String(index + 1).padStart(3, '0'),
    })),
  };

  assertValidVideoEditDecisionList(decisionList);
  return decisionList;
};

export const assertValidVideoEditDecisionList = (
  decisionList: VideoEditDecisionListV1
) => {
  if (
    decisionList.schemaVersion !== VIDEO_EDIT_DECISION_SCHEMA_VERSION ||
    decisionList.strategy !== 'talking-head-dead-air-v1' ||
    !isValidTalkingHeadStyleMetadata(decisionList.style) ||
    !Number.isInteger(decisionList.source.durationMs) ||
    decisionList.source.durationMs <= 0 ||
    !decisionList.decisions.length
  ) {
    throw new VideoEditDecisionError(
      'INVALID_EDIT_DECISIONS',
      'The edit-decision list is invalid.'
    );
  }

  let cursorMs = 0;
  let keepCount = 0;
  for (const decision of decisionList.decisions) {
    if (
      !decision.id ||
      !['keep', 'cut'].includes(decision.action) ||
      !Number.isInteger(decision.sourceStartMs) ||
      !Number.isInteger(decision.sourceEndMs) ||
      decision.sourceStartMs !== cursorMs ||
      decision.sourceEndMs <= decision.sourceStartMs ||
      decision.sourceEndMs > decisionList.source.durationMs ||
      !decision.reasons.length
    ) {
      throw new VideoEditDecisionError(
        'INVALID_EDIT_DECISIONS',
        'Edit decisions must be ordered, contiguous, and inside the source duration.'
      );
    }

    if (decision.action === 'keep') {
      keepCount += 1;
    }
    cursorMs = decision.sourceEndMs;
  }

  if (cursorMs !== decisionList.source.durationMs || !keepCount) {
    throw new VideoEditDecisionError(
      'INVALID_EDIT_DECISIONS',
      'Edit decisions must cover the source and retain at least one segment.'
    );
  }
};

export const getKeptDurationMs = (decisionList: VideoEditDecisionListV1) =>
  decisionList.decisions.reduce(
    (durationMs, decision) =>
      durationMs +
      (decision.action === 'keep'
        ? decision.sourceEndMs - decision.sourceStartMs
        : 0),
    0
  );
