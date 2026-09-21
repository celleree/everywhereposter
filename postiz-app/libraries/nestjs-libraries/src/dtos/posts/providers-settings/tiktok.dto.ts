import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class TikTokDto {
  @ValidateIf((p) => p.title)
  @MaxLength(90)
  title: string;

  @ValidateIf((p) => p.content_posting_method === 'DIRECT_POST')
  @IsNotEmpty()
  @IsString()
  privacy_level?: string;

  @IsBoolean()
  duet: boolean;

  @IsBoolean()
  stitch: boolean;

  @IsBoolean()
  comment: boolean;

  @IsIn(['yes', 'no'])
  autoAddMusic: 'yes' | 'no';

  @IsBoolean()
  @IsOptional()
  disclose?: boolean;

  @IsBoolean()
  brand_content_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  video_made_with_ai: boolean;

  @IsBoolean()
  brand_organic_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  __tiktok_creator_info_loaded?: boolean;

  @IsString()
  @IsOptional()
  __tiktok_creator_info_error?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  __tiktok_max_video_duration_sec?: number;

  @IsString()
  @IsOptional()
  __tiktok_privacy_level_options_json?: string;

  @IsIn(['DIRECT_POST', 'UPLOAD'])
  @IsString()
  content_posting_method: 'DIRECT_POST' | 'UPLOAD';
}
