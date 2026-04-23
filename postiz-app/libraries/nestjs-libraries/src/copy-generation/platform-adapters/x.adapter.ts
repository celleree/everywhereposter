import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const xAdapter: PlatformAdapter = {
  platform: 'x',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Make the first line do the work. Keep it tight, immediate, and worth reacting to. Do not write a mini-essay.'
    ),
};
