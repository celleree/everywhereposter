import {
  CopyPlatform,
  CopyTargetLength,
  HashtagBehavior,
  LineBreakBehavior,
  PlatformCtaStyle,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import type { CaptionMode } from '@gitroom/nestjs-libraries/copy-generation/caption-modes';

export interface CopyGenerationWarning {
  code: string;
  message: string;
}

export interface VoiceProfileSnapshot {
  sentenceLength: 'short' | 'mixed' | 'long';
  lineBreakHabit: LineBreakBehavior;
  ctaStyle: PlatformCtaStyle;
  vocabularyTendencies: string[];
  tabooPhrases: string[];
  preferredOpenings: string[];
  confidence: number;
}

export interface CopyGenerationVisualScene {
  timestampSeconds: number;
  description: string;
  visibleText: string;
  usefulForPosting: boolean;
}

export type ImagePlanType =
  | 'video_frame'
  | 'quote_card'
  | 'ai_visual'
  | 'thumbnail';

export type ImagePlanAspectRatio = '1:1' | '4:5' | '16:9' | '9:16';

export interface ImagePlanItem {
  id: string;
  type: ImagePlanType;
  platform: CopyPlatform;
  purpose: string;
  rationale: string;
  aspectRatio: ImagePlanAspectRatio;
  title?: string;
  headline?: string;
  subheadline?: string;
  captionHint?: string;
  sourceTimestampSeconds?: number;
  sourceQuote?: string;
  visualSummary: string;
  visualPrompt?: string;
  altText: string;
  confidence: number;
  warnings: string[];
}

export interface CopyGenerationBrief {
  source: {
    mediaType: 'image' | 'video';
    visualSummary: string;
    transcriptSummary?: string;
    facts: string[];
    unknowns: string[];
    scenes?: CopyGenerationVisualScene[];
  };
  strategy: {
    audience?: string;
    goal: string;
    captionMode?: CaptionMode;
    sourceCaption?: string;
    additionalContext?: string;
    ctaPreference?: {
      strength: 'none' | 'soft' | 'medium' | 'direct';
      action?: string;
    };
    coreMessage: string;
  };
  personalization: {
    knowledgeBaseFacts: string[];
    voiceProfile?: VoiceProfileSnapshot;
  };
  platform: {
    name: CopyPlatform;
    hardCap: number;
    targetLength: CopyTargetLength;
    targetCharacters: number;
    lineBreaks: LineBreakBehavior;
    hashtags: HashtagBehavior;
    ctaStyle: PlatformCtaStyle;
    tone: string;
    nativeFeel: string;
  };
}

export interface GenerateMediaCopyResult {
  platform: CopyPlatform;
  draft: string;
  origin: 'generated' | 'original' | 'adapted';
  angle?: string;
  hook?: string;
  cta?: string;
  charCount: number;
  confidence: number | null;
  antiGenericScore: number | null;
  rewritten: boolean;
  warnings: CopyGenerationWarning[];
}

export interface GenerateMediaCopyResponse {
  requestId: string;
  status: 'complete' | 'partial' | 'failed';
  sourceConfidence: number | null;
  warnings: CopyGenerationWarning[];
  results: GenerateMediaCopyResult[];
  imagePlans: ImagePlanItem[];
}

export interface CopyGenerationStreamEvent<T = any> {
  name: string;
  data: T;
}
