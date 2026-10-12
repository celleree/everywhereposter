import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { VIDEO_CHUNK_BYTES, VIDEO_MAX_BYTES } from '../../upload/resumable-video.validation';

export class CreateVideoUploadDto {
  @IsString() @MaxLength(128)
  organizationId: string;

  @IsString() @Matches(/^[a-zA-Z0-9_-]{16,128}$/)
  clientId: string;

  @IsString() @MaxLength(200) @Matches(/\.(mp4|mov)$/i)
  originalName: string;

  @IsInt() @Min(1) @Max(VIDEO_MAX_BYTES)
  byteSize: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(Math.ceil(VIDEO_MAX_BYTES / VIDEO_CHUNK_BYTES))
  @IsString({ each: true }) @Matches(/^[a-f0-9]{64}$/, { each: true })
  manifest: string[];
}
