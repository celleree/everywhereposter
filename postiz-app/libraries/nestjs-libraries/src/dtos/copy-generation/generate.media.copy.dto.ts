import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  COPY_PLATFORMS,
  COPY_TARGET_LENGTHS,
  HASHTAG_BEHAVIORS,
  LINE_BREAK_BEHAVIORS,
  PLATFORM_CTA_STYLES,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import type {
  CopyPlatform,
  CopyTargetLength,
  HashtagBehavior,
  LineBreakBehavior,
  PlatformCtaStyle,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import {
  ADDITIONAL_CONTEXT_MAX_LENGTH,
  CAPTION_MODES,
  SOURCE_CAPTION_MAX_LENGTH,
} from '@gitroom/nestjs-libraries/copy-generation/caption-modes';
import type { CaptionMode } from '@gitroom/nestjs-libraries/copy-generation/caption-modes';

export class CtaPreferenceDto {
  @IsString()
  @IsIn(['none', 'soft', 'medium', 'direct'])
  strength: 'none' | 'soft' | 'medium' | 'direct';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;
}

export class TranscriptInputDto {
  @IsString()
  @MaxLength(50000)
  text: string;

  @IsString()
  @IsIn(['manual', 'generated'])
  source: 'manual' | 'generated';

  @IsOptional()
  @IsNumber()
  @Min(0)
  confidence?: number;
}

export class KnowledgeBaseFactDto {
  @IsString()
  @MaxLength(500)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  confidence?: number;
}

export class PlatformControlDto {
  @IsOptional()
  @IsNumber()
  @Min(50)
  hardCap?: number;

  @IsOptional()
  @IsString()
  @IsIn(COPY_TARGET_LENGTHS)
  targetLength?: CopyTargetLength;

  @IsOptional()
  @IsString()
  @IsIn(LINE_BREAK_BEHAVIORS)
  lineBreaks?: LineBreakBehavior;

  @IsOptional()
  @IsString()
  @IsIn(HASHTAG_BEHAVIORS)
  hashtags?: HashtagBehavior;

  @IsOptional()
  @IsString()
  @IsIn(PLATFORM_CTA_STYLES)
  ctaStyle?: PlatformCtaStyle;
}

export class GenerateMediaCopyDto {
  @IsString()
  mediaId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(COPY_PLATFORMS.length)
  @ArrayUnique()
  @IsIn(COPY_PLATFORMS, { each: true })
  platforms: CopyPlatform[];

  @IsString()
  @IsIn(CAPTION_MODES)
  captionMode: CaptionMode = 'generate';

  @ValidateIf(
    (body: GenerateMediaCopyDto, value: unknown) =>
      body.captionMode !== 'generate' || (value !== undefined && value !== '')
  )
  @IsString()
  @Matches(/\S/, { message: 'sourceCaption must contain non-whitespace text' })
  @MaxLength(SOURCE_CAPTION_MAX_LENGTH)
  sourceCaption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ADDITIONAL_CONTEXT_MAX_LENGTH)
  additionalContext?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  audience?: string;

  @IsString()
  @IsIn(['attract', 'nurture', 'position', 'convert'])
  goal: 'attract' | 'nurture' | 'position' | 'convert';

  @IsOptional()
  @ValidateNested()
  @Type(() => CtaPreferenceDto)
  ctaPreference?: CtaPreferenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TranscriptInputDto)
  transcript?: TranscriptInputDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KnowledgeBaseFactDto)
  knowledgeBaseFacts?: KnowledgeBaseFactDto[];

  @IsOptional()
  @IsString()
  voiceProfileId?: string;

  @IsOptional()
  @IsObject()
  platformControls?: Partial<Record<CopyPlatform, PlatformControlDto>>;
}
