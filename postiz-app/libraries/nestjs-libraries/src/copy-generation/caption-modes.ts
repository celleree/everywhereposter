export const CAPTION_MODES = [
  'generate',
  'use-everywhere',
  'adapt-by-platform',
] as const;

export type CaptionMode = (typeof CAPTION_MODES)[number];

export const SOURCE_CAPTION_MAX_LENGTH = 63206;
export const ADDITIONAL_CONTEXT_MAX_LENGTH = 5000;
