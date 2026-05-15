import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const instagramAdapter: PlatformAdapter = {
  platform: 'instagram',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Write a caption that is grounded in the visual media. Lead with a clear first line, avoid generic inspirational filler, and keep hashtags sparse.'
    ),
};
