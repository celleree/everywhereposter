import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadKnowledgeTranscriptDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
