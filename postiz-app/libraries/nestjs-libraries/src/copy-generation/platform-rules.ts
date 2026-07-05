export const COPY_PLATFORMS = [
  'linkedin',
  'x',
  'threads',
  'facebook',
  'instagram',
  'bluesky',
] as const;

export const COPY_TARGET_LENGTHS = ['short', 'medium', 'long'] as const;
export const LINE_BREAK_BEHAVIORS = ['tight', 'moderate', 'airy'] as const;
export const HASHTAG_BEHAVIORS = ['none', 'sparse', 'end_only'] as const;
export const PLATFORM_CTA_STYLES = [
  'none',
  'question',
  'invite',
  'direct',
] as const;

export type CopyPlatform = typeof COPY_PLATFORMS[number];
export type CopyTargetLength = typeof COPY_TARGET_LENGTHS[number];
export type LineBreakBehavior = typeof LINE_BREAK_BEHAVIORS[number];
export type HashtagBehavior = typeof HASHTAG_BEHAVIORS[number];
export type PlatformCtaStyle = typeof PLATFORM_CTA_STYLES[number];

export const X_MAX_CHARACTERS = 280;

export interface PlatformRule {
  hardCap: number;
  targetCharacters: Record<CopyTargetLength, number>;
  defaultTargetLength: CopyTargetLength;
  lineBreaks: LineBreakBehavior;
  hashtags: HashtagBehavior;
  ctaStyle: PlatformCtaStyle;
  tone: string;
  nativeFeel: string;
}

export interface PlatformRuleOverrides {
  hardCap?: number;
  targetLength?: CopyTargetLength;
  lineBreaks?: LineBreakBehavior;
  hashtags?: HashtagBehavior;
  ctaStyle?: PlatformCtaStyle;
}

export const PLATFORM_RULES: Record<CopyPlatform, PlatformRule> = {
  linkedin: {
    hardCap: 3000,
    targetCharacters: {
      short: 700,
      medium: 950,
      long: 1200,
    },
    defaultTargetLength: 'medium',
    lineBreaks: 'airy',
    hashtags: 'end_only',
    ctaStyle: 'invite',
    tone:
      'founder/operator insight, concrete lesson, structured specificity, measured confidence',
    nativeFeel:
      'Write one strong LinkedIn text post from the video/transcript: a clear observation, a specific supporting detail, and a grounded takeaway. Do not mass-generate angles or stretch into weak long-form filler.',
  },
  x: {
    hardCap: X_MAX_CHARACTERS,
    targetCharacters: {
      short: 180,
      medium: 220,
      long: 240,
    },
    defaultTargetLength: 'medium',
    lineBreaks: 'tight',
    hashtags: 'none',
    ctaStyle: 'question',
    tone: 'sharp single insight, opinionated, concise, source-grounded',
    nativeFeel:
      'Internally consider several hooks or angles from the video/transcript, then return the strongest single text post. It should be short, specific, and easy to post; never a mini-blog.',
  },
  threads: {
    hardCap: 500,
    targetCharacters: {
      short: 220,
      medium: 320,
      long: 450,
    },
    defaultTargetLength: 'medium',
    lineBreaks: 'moderate',
    hashtags: 'none',
    ctaStyle: 'invite',
    tone: 'conversational, personal, current, specific short-form',
    nativeFeel:
      'Internally consider a few conversational angles from the video/transcript, then return one natural Threads post. It can feel reflective or lightly opinionated, but should stay short and concrete.',
  },
  facebook: {
    hardCap: 63206,
    targetCharacters: {
      short: 180,
      medium: 350,
      long: 600,
    },
    defaultTargetLength: 'medium',
    lineBreaks: 'moderate',
    hashtags: 'none',
    ctaStyle: 'invite',
    tone: 'conversational, community-readable, context-forward, human',
    nativeFeel:
      'Write like a real update to a community or client audience: approachable, grounded in the video/transcript, with enough context to invite conversation. Do not sound like ad copy.',
  },
  instagram: {
    hardCap: 2200,
    targetCharacters: {
      short: 120,
      medium: 220,
      long: 350,
    },
    defaultTargetLength: 'medium',
    lineBreaks: 'moderate',
    hashtags: 'sparse',
    ctaStyle: 'invite',
    tone: 'visual, concrete, warm, caption-native',
    nativeFeel:
      'Write as an Instagram caption grounded in the media, with a clear first line and no generic creator filler.',
  },
  bluesky: {
    hardCap: 300,
    targetCharacters: {
      short: 120,
      medium: 180,
      long: 260,
    },
    defaultTargetLength: 'medium',
    lineBreaks: 'tight',
    hashtags: 'none',
    ctaStyle: 'question',
    tone: 'internet-native, lightly opinionated, specific',
    nativeFeel:
      'Feel native to Bluesky: concise, pointed, and not corporate or overpolished.',
  },
};

export const resolvePlatformRule = (
  platform: CopyPlatform,
  overrides?: PlatformRuleOverrides
) => {
  const rule = PLATFORM_RULES[platform];
  const targetLength = overrides?.targetLength || rule.defaultTargetLength;

  return {
    name: platform,
    hardCap: overrides?.hardCap || rule.hardCap,
    targetLength,
    targetCharacters: rule.targetCharacters[targetLength],
    lineBreaks: overrides?.lineBreaks || rule.lineBreaks,
    hashtags: overrides?.hashtags || rule.hashtags,
    ctaStyle: overrides?.ctaStyle || rule.ctaStyle,
    tone: rule.tone,
    nativeFeel: rule.nativeFeel,
  };
};

export const mapIntegrationIdentifierToCopyPlatform = (
  identifier: string
): CopyPlatform | null => {
  const rootIdentifier = identifier.split('-')[0] as CopyPlatform;
  return COPY_PLATFORMS.includes(rootIdentifier) ? rootIdentifier : null;
};
