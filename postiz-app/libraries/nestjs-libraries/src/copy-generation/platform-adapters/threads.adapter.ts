import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const threadsAdapter: PlatformAdapter = {
  platform: 'threads',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Let it feel current and personal, but still concrete. A small reflective turn is fine if it stays specific.'
    ),
};
