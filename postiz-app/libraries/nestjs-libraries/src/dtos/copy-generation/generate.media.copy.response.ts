import {
  CopyPlatform,
  CopyTargetLength,
  HashtagBehavior,
  LineBreakBehavior,
  PlatformCtaStyle,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';

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

export interface CopyGenerationBrief {
  source: {
    mediaType: 'image' | 'video';
    visualSummary: string;
    transcriptSummary?: string;
    facts: string[];
    unknowns: string[];
  };
  strategy: {
    audience?: string;
    goal: string;
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
  angle?: string;
  hook?: string;
  cta?: string;
  charCount: number;
  confidence: number;
  antiGenericScore: number;
  rewritten: boolean;
  warnings: CopyGenerationWarning[];
}

export interface GenerateMediaCopyResponse {
  requestId: string;
  status: 'complete' | 'partial' | 'failed';
  sourceConfidence: number;
  warnings: CopyGenerationWarning[];
  results: GenerateMediaCopyResult[];
}

export interface CopyGenerationStreamEvent<T = any> {
  name: string;
  data: T;
}
