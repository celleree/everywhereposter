import {
  assertValidVideoEditDecisionList,
  buildVideoEditDecisionList,
  getKeptDurationMs,
  parseSilenceDetectionOutput,
  VideoEditDecisionError,
  VideoEditDecisionListV1,
} from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';
import {
  createTalkingHeadStylePlan,
  toTalkingHeadStyleMetadata,
} from '@gitroom/nestjs-libraries/media-editing/talking-head-style';

const balancedStyle = toTalkingHeadStyleMetadata(
  createTalkingHeadStylePlan({
    stylePrompt: 'Keep the pacing natural and balanced.',
    pacingPreset: 'balanced',
    plannerSource: 'deterministic-fallback',
  })
);

const baseInput = {
  mediaId: 'media-1',
  durationMs: 10_000,
  style: balancedStyle,
  transcription: {
    id: 'transcription-1',
    generation: 2,
    text: 'A useful talking head transcript.',
  },
  silenceThresholdDb: -35,
  minimumSilenceMs: 650,
  speechPaddingMs: 120,
  maxKeepRanges: 200,
};

describe('video edit decisions', () => {
  it('parses bounded and trailing FFmpeg silence events', () => {
    const output = [
      '[silencedetect] silence_start: 0',
      '[silencedetect] silence_end: 1.25 | silence_duration: 1.25',
      '[silencedetect] silence_start: 4.5',
    ].join('\n');

    expect(parseSilenceDetectionOutput(output, 6_000)).toEqual([
      { sourceStartMs: 0, sourceEndMs: 1_250 },
      { sourceStartMs: 4_500, sourceEndMs: 6_000 },
    ]);
  });

  it('builds a complete editor-neutral partition with speech padding', () => {
    const decisionList = buildVideoEditDecisionList({
      ...baseInput,
      detectedSilence: [
        { sourceStartMs: 0, sourceEndMs: 1_000 },
        { sourceStartMs: 3_000, sourceEndMs: 5_000 },
        { sourceStartMs: 9_000, sourceEndMs: 10_000 },
      ],
    });

    expect(decisionList.decisions).toEqual([
      {
        id: 'decision-001',
        action: 'cut',
        sourceStartMs: 0,
        sourceEndMs: 880,
        reasons: ['silence', 'dead_air'],
      },
      {
        id: 'decision-002',
        action: 'keep',
        sourceStartMs: 880,
        sourceEndMs: 3_120,
        reasons: ['audible_content'],
      },
      {
        id: 'decision-003',
        action: 'cut',
        sourceStartMs: 3_120,
        sourceEndMs: 4_880,
        reasons: ['silence', 'dead_air'],
      },
      {
        id: 'decision-004',
        action: 'keep',
        sourceStartMs: 4_880,
        sourceEndMs: 9_120,
        reasons: ['audible_content'],
      },
      {
        id: 'decision-005',
        action: 'cut',
        sourceStartMs: 9_120,
        sourceEndMs: 10_000,
        reasons: ['silence', 'dead_air'],
      },
    ]);
    expect(decisionList.source.transcription).toEqual({
      id: 'transcription-1',
      generation: 2,
      alignment: 'none',
      characterCount: 33,
      wordCount: 5,
      semanticSelectionApplied: false,
    });
    expect(decisionList.style).toEqual(balancedStyle);
    expect(JSON.stringify(decisionList)).not.toContain(
      baseInput.transcription.text
    );
    expect(JSON.stringify(decisionList)).not.toContain(
      'Keep the pacing natural and balanced.'
    );
    expect(getKeptDurationMs(decisionList)).toBe(6_480);
  });

  it('keeps the full video when no qualifying dead air is detected', () => {
    const decisionList = buildVideoEditDecisionList({
      ...baseInput,
      detectedSilence: [{ sourceStartMs: 2_000, sourceEndMs: 2_500 }],
    });

    expect(decisionList.decisions).toEqual([
      {
        id: 'decision-001',
        action: 'keep',
        sourceStartMs: 0,
        sourceEndMs: 10_000,
        reasons: ['audible_content'],
      },
    ]);
  });

  it('rejects all-silence sources and invalid non-contiguous decisions', () => {
    expect(() =>
      buildVideoEditDecisionList({
        ...baseInput,
        detectedSilence: [{ sourceStartMs: 0, sourceEndMs: 10_000 }],
      })
    ).toThrow(
      expect.objectContaining<Partial<VideoEditDecisionError>>({
        code: 'NO_USEFUL_SEGMENTS',
      })
    );

    const invalid = buildVideoEditDecisionList({
      ...baseInput,
      detectedSilence: [],
    }) as VideoEditDecisionListV1;
    invalid.decisions[0].sourceStartMs = 1;
    expect(() => assertValidVideoEditDecisionList(invalid)).toThrow(
      expect.objectContaining<Partial<VideoEditDecisionError>>({
        code: 'INVALID_EDIT_DECISIONS',
      })
    );
  });
});
