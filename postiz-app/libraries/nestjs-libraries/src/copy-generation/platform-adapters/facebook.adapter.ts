import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const facebookAdapter: PlatformAdapter = {
  platform: 'facebook',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Write like a context-rich update to a real audience. Do not borrow thread syntax or creator-template pacing.'
    ),
};
