import { CopyGenerationBrief } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
import { CopyPlatform } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';

export interface PlatformAdapter {
  platform: CopyPlatform;
  buildSystemPrompt: (brief: CopyGenerationBrief) => string;
}
