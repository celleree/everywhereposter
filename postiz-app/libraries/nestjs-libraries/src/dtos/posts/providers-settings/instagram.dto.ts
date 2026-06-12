import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateNested,
  IsOptional,
} from 'class-validator';

const normalizeCollaboratorLabel = (value: unknown) =>
  String(value || '')
    .trim()
    .replace(/^@+/, '')
    .trim();

export class Collaborators {
  @Transform(({ value }) => normalizeCollaboratorLabel(value))
  @IsDefined()
  @IsString()
  @IsNotEmpty()
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
  @ArrayMaxSize(3)
  @ArrayUnique((collaborator: Collaborators) =>
    collaborator?.label?.toLowerCase()
  )
  @IsOptional()
  collaborators?: Collaborators[];
}
