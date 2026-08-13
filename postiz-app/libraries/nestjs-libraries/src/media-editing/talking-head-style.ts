export const TALKING_HEAD_STYLE_SCHEMA_VERSION = 1 as const;
export const TALKING_HEAD_STYLE_PROMPT_MAX_LENGTH = 500;

export const TALKING_HEAD_PACING_PRESETS = [
  'tight',
  'balanced',
  'relaxed',
] as const;

export type TalkingHeadPacingPreset =
  (typeof TALKING_HEAD_PACING_PRESETS)[number];

export const TALKING_HEAD_STYLE_WARNINGS = [
  'semantic_content_selection_unavailable',
  'captions_unavailable',
  'broll_unavailable',
  'music_unavailable',
  'transitions_unavailable',
  'reordering_unavailable',
  'style_planner_unavailable',
  'style_prompt_defaulted_to_balanced',
] as const;

export type TalkingHeadStyleWarning =
  (typeof TALKING_HEAD_STYLE_WARNINGS)[number];

export type TalkingHeadStylePlannerSource =
  | 'openai-structured-output'
  | 'deterministic-fallback';

export interface TalkingHeadStyleSettings {
  silenceThresholdDb: number;
  minimumSilenceMs: number;
  speechPaddingMs: number;
}

export interface TalkingHeadStyleMetadata {
  schemaVersion: typeof TALKING_HEAD_STYLE_SCHEMA_VERSION;
  operation: 'remove_dead_air';
  pacingPreset: TalkingHeadPacingPreset;
  promptCharacterCount: number;
  warnings: TalkingHeadStyleWarning[];
  plannerSource: TalkingHeadStylePlannerSource;
}

export interface TalkingHeadStylePlan extends TalkingHeadStyleMetadata {
  summary: string;
  settings: TalkingHeadStyleSettings;
  plannerModel: string | null;
}

export const TALKING_HEAD_STYLE_PRESET_SETTINGS: Record<
  TalkingHeadPacingPreset,
  TalkingHeadStyleSettings
> = {
  tight: {
    silenceThresholdDb: -35,
    minimumSilenceMs: 350,
    speechPaddingMs: 80,
  },
  balanced: {
    silenceThresholdDb: -35,
    minimumSilenceMs: 650,
    speechPaddingMs: 120,
  },
  relaxed: {
    silenceThresholdDb: -35,
    minimumSilenceMs: 1100,
    speechPaddingMs: 220,
  },
};

const TALKING_HEAD_STYLE_SUMMARIES: Record<TalkingHeadPacingPreset, string> = {
  tight: 'Tight pacing with short pauses removed and concise breathing room.',
  balanced:
    'Balanced pacing that removes clear dead air while preserving a natural rhythm.',
  relaxed: 'Relaxed pacing that keeps longer pauses and more breathing room.',
};

const TIGHT_STYLE_PATTERN =
  /\b(tight|punchy|fast|snappy|quick|energetic|aggressive|high[ -]?energy|short[ -]?form|tiktok|reel)\b/i;
const RELAXED_STYLE_PATTERN =
  /\b(relaxed|natural|conversational|slow|calm|thoughtful|gentle|authentic|breathing room|preserve pauses?)\b/i;

const UNSUPPORTED_STYLE_PATTERNS: Array<{
  warning: TalkingHeadStyleWarning;
  pattern: RegExp;
}> = [
  {
    warning: 'semantic_content_selection_unavailable',
    pattern:
      /\b(best moments?|highlights?|off[ -]?topic|boring|filler|mistakes?|retakes?|remove (?:ums?|uhs?))\b/i,
  },
  {
    warning: 'captions_unavailable',
    pattern: /\b(captions?|subtitles?|burn[ -]?in text)\b/i,
  },
  {
    warning: 'broll_unavailable',
    pattern: /\b(b[ -]?roll|cutaways?|stock footage)\b/i,
  },
  {
    warning: 'music_unavailable',
    pattern: /\b(music|soundtrack|background song|add a song)\b/i,
  },
  {
    warning: 'transitions_unavailable',
    pattern: /\b(transitions?|fades?|animations?|zoom effects?)\b/i,
  },
  {
    warning: 'reordering_unavailable',
    pattern: /\b(reorder|rearrange|move .* before|change the order)\b/i,
  },
];

export const normalizeTalkingHeadStylePrompt = (stylePrompt: string) =>
  stylePrompt.trim().replace(/\s+/g, ' ');

export const getTalkingHeadStylePromptCharacterCount = (stylePrompt: string) =>
  Array.from(normalizeTalkingHeadStylePrompt(stylePrompt)).length;

export const getUnsupportedTalkingHeadStyleWarnings = (stylePrompt: string) =>
  UNSUPPORTED_STYLE_PATTERNS.flatMap(({ pattern, warning }) =>
    pattern.test(stylePrompt) ? [warning] : []
  );

export const resolveFallbackTalkingHeadPacingPreset = (
  stylePrompt: string
): {
  pacingPreset: TalkingHeadPacingPreset;
  defaulted: boolean;
} => {
  const tight = TIGHT_STYLE_PATTERN.test(stylePrompt);
  const relaxed = RELAXED_STYLE_PATTERN.test(stylePrompt);

  if (tight && !relaxed) {
    return { pacingPreset: 'tight', defaulted: false };
  }
  if (relaxed && !tight) {
    return { pacingPreset: 'relaxed', defaulted: false };
  }

  return { pacingPreset: 'balanced', defaulted: !tight && !relaxed };
};

export const createTalkingHeadStylePlan = (params: {
  stylePrompt: string;
  pacingPreset: TalkingHeadPacingPreset;
  warnings?: TalkingHeadStyleWarning[];
  plannerSource: TalkingHeadStylePlannerSource;
  plannerModel?: string | null;
}): TalkingHeadStylePlan => {
  return {
    schemaVersion: TALKING_HEAD_STYLE_SCHEMA_VERSION,
    operation: 'remove_dead_air',
    pacingPreset: params.pacingPreset,
    promptCharacterCount: getTalkingHeadStylePromptCharacterCount(
      params.stylePrompt
    ),
    warnings: Array.from(new Set(params.warnings || [])),
    plannerSource: params.plannerSource,
    plannerModel: params.plannerModel || null,
    summary: TALKING_HEAD_STYLE_SUMMARIES[params.pacingPreset],
    settings: { ...TALKING_HEAD_STYLE_PRESET_SETTINGS[params.pacingPreset] },
  };
};

export const createFallbackTalkingHeadStylePlan = (
  stylePrompt: string,
  additionalWarnings: TalkingHeadStyleWarning[] = []
) => {
  const { pacingPreset, defaulted } =
    resolveFallbackTalkingHeadPacingPreset(stylePrompt);
  const warnings = [
    ...getUnsupportedTalkingHeadStyleWarnings(stylePrompt),
    ...additionalWarnings,
    ...(defaulted ? (['style_prompt_defaulted_to_balanced'] as const) : []),
  ];

  return createTalkingHeadStylePlan({
    stylePrompt,
    pacingPreset,
    warnings,
    plannerSource: 'deterministic-fallback',
  });
};

export const toTalkingHeadStyleMetadata = (
  plan: TalkingHeadStylePlan
): TalkingHeadStyleMetadata => ({
  schemaVersion: plan.schemaVersion,
  operation: plan.operation,
  pacingPreset: plan.pacingPreset,
  promptCharacterCount: plan.promptCharacterCount,
  warnings: [...plan.warnings],
  plannerSource: plan.plannerSource,
});

export const isValidTalkingHeadStyleMetadata = (
  value: TalkingHeadStyleMetadata
) =>
  value?.schemaVersion === TALKING_HEAD_STYLE_SCHEMA_VERSION &&
  value.operation === 'remove_dead_air' &&
  TALKING_HEAD_PACING_PRESETS.includes(value.pacingPreset) &&
  Number.isInteger(value.promptCharacterCount) &&
  value.promptCharacterCount > 0 &&
  value.promptCharacterCount <= TALKING_HEAD_STYLE_PROMPT_MAX_LENGTH &&
  Array.isArray(value.warnings) &&
  value.warnings.every((warning) =>
    TALKING_HEAD_STYLE_WARNINGS.includes(warning)
  ) &&
  (value.plannerSource === 'openai-structured-output' ||
    value.plannerSource === 'deterministic-fallback');
