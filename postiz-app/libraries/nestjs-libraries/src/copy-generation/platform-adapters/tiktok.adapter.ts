import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const tiktokAdapter: PlatformAdapter = {
  platform: 'tiktok',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Short-form video caption mode. Write one TikTok caption that complements the video instead of restating it. Lead with a specific hook or useful context, keep the language natural and concise, and use only a few relevant hashtags. Do not invent trends, sounds, or challenges.'
    ),
};
