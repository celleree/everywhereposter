import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateKnowledgeTranscriptDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsString()
  @MaxLength(150000)
  text: string;
}
