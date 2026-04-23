import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const linkedinAdapter: PlatformAdapter = {
  platform: 'linkedin',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Lead with a concrete lesson or observation. Use airy spacing when it helps readability. End with a grounded invite, not a hype CTA.'
    ),
};
