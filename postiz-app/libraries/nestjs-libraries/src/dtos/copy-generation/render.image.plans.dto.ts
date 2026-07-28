import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COPY_PLATFORMS,
  CopyPlatform,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import {
  ImagePlanAspectRatio,
  ImagePlanType,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

export const RENDER_IMAGE_PLAN_TYPES: ImagePlanType[] = [
  'video_frame',
  'quote_card',
  'ai_visual',
  'thumbnail',
];

export const RENDER_IMAGE_PLAN_ASPECT_RATIOS: ImagePlanAspectRatio[] = [
  '1:1',
  '4:5',
  '16:9',
  '9:16',
];

export class RenderImagePlanItemDto {
  @IsString()
  @MaxLength(64)
  id: string;

  @IsString()
  @IsIn(RENDER_IMAGE_PLAN_TYPES)
  type: ImagePlanType;

  @IsString()
  @IsIn(COPY_PLATFORMS)
  platform: CopyPlatform;

  @IsString()
  @MaxLength(500)
  purpose: string;

  @IsString()
  @MaxLength(500)
  rationale: string;

  @IsString()
  @IsIn(RENDER_IMAGE_PLAN_ASPECT_RATIOS)
  aspectRatio: ImagePlanAspectRatio;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  subheadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  captionHint?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sourceTimestampSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceQuote?: string;

  @IsString()
  @MaxLength(1000)
  visualSummary: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  visualPrompt?: string;

  @IsString()
  @MaxLength(1000)
  altText: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  warnings: string[];
}

export class RenderImagePlansDto {
  @IsString()
  mediaId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(8)
  @ArrayUnique((plan: RenderImagePlanItemDto) => plan.id)
  @ValidateNested({ each: true })
  @Type(() => RenderImagePlanItemDto)
  imagePlans: RenderImagePlanItemDto[];
}
