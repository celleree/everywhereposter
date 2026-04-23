import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const blueskyAdapter: PlatformAdapter = {
  platform: 'bluesky',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Keep it concise and internet-native. Slightly opinionated is okay; corporate phrasing is not.'
    ),
};
