import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const facebookAdapter: PlatformAdapter = {
  platform: 'facebook',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Write a conversational, community-readable post with slightly more context than X or Threads. Make it feel like a human update to people who know the topic. Do not sound like an ad, landing-page copy, or repackaged thread.'
    ),
};
