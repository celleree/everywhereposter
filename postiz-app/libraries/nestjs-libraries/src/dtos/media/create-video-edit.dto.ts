import { Equals, IsIn, IsOptional } from 'class-validator';
import { PacingPreset } from '../../media-editing/video-edit-decision';

export class CreateVideoEditDto {
  @Equals(1)
  schemaVersion: 1;

  @IsOptional()
  @IsIn(['tight', 'balanced', 'relaxed'])
  pacingPreset?: PacingPreset;
}
