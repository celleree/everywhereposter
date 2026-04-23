import { CopyPlatform } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import { PlatformAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/platform.adapter';
import { linkedinAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/linkedin.adapter';
import { xAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/x.adapter';
import { threadsAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/threads.adapter';
import { facebookAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/facebook.adapter';
import { blueskyAdapter } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/bluesky.adapter';

export const platformAdapters: Record<CopyPlatform, PlatformAdapter> = {
  linkedin: linkedinAdapter,
  x: xAdapter,
  threads: threadsAdapter,
  facebook: facebookAdapter,
  bluesky: blueskyAdapter,
};
