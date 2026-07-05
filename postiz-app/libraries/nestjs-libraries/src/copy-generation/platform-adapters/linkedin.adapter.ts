import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const linkedinAdapter: PlatformAdapter = {
  platform: 'linkedin',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Prioritize one strong founder/operator-style post. Lead with a concrete lesson or observation, use source-specific detail, structure it for readability, and end with a grounded invite. Do not produce several weak angles or pad a long post.'
    ),
};
