import { IsString, Matches, MaxLength } from 'class-validator';
import { TALKING_HEAD_STYLE_PROMPT_MAX_LENGTH } from '@gitroom/nestjs-libraries/media-editing/talking-head-style';

export class CreateTalkingHeadEditDto {
  @IsString()
  @Matches(/\S/, {
    message: 'stylePrompt must contain non-whitespace text',
  })
  @MaxLength(TALKING_HEAD_STYLE_PROMPT_MAX_LENGTH)
  stylePrompt: string;
}
