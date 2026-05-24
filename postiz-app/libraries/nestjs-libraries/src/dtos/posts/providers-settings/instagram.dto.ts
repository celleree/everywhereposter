import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsString,
  ValidateNested,
  IsOptional,
} from 'class-validator';

export class Collaborators {
  @IsDefined()
  @IsString()
  label: string;
}
export class InstagramDto {
  @IsIn(['post', 'reel', 'story'])
  @IsOptional()
  post_type?: 'post' | 'reel' | 'story';

  @IsOptional()
  post_type_explicit?: boolean;

  @IsOptional()
  is_trial_reel?: boolean;

  @IsIn(['MANUAL', 'SS_PERFORMANCE'])
  @IsOptional()
  graduation_strategy?: 'MANUAL' | 'SS_PERFORMANCE';

  @Type(() => Collaborators)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  collaborators: Collaborators[];
}
