import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Video description mode. Write one useful YouTube description grounded in the source. Explain what the viewer will get, include concrete details, and use an appropriate CTA when requested. Do not invent links, timestamps, chapters, sponsors, or claims.'
    ),
};
