import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';

export const xAdapter: PlatformAdapter = {
  platform: 'x',
  buildSystemPrompt: (brief) =>
    buildBasePlatformPrompt(
      brief,
      'Internally consider 3-5 hooks, opinions, or short insights from the source, then return only the strongest single X post. Make the first line do the work. Keep it tight, immediate, and worth reacting to. Do not write a mini-blog.'
    ),
};
