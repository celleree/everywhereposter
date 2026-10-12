import type { Integrations } from '../launches/calendar.context';
import { mapIntegrationIdentifierToCopyPlatform } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import type {
  GenerateMediaCopyResponse,
  GenerateMediaCopyResult,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

export interface QuickUploadSkip {
  integration: string;
  message: string;
}

// These are the existing video publishers with platform-specific copy support.
// TikTok requires explicit per-video privacy/disclosure choices in Customize.
export const quickUploadAccountReason = (
  account: Integrations
): string | null => {
  if (account.disabled) return 'Account is disabled.';
  if (account.refreshNeeded || account.publishedCapabilities?.requiresReconnect)
    return 'Reconnect this account.';
  if (account.inBetweenSteps) return 'Finish connecting this account.';
  if (
    account.type !== 'social' ||
    !mapIntegrationIdentifierToCopyPlatform(account.identifier)
  )
    return 'Automatic video captions are unavailable; use Customize.';
  if (account.identifier === 'tiktok')
    return 'TikTok requires per-video privacy and disclosure choices; use Customize.';
  return null;
};

export const quickUploadCopyReason = (
  response: GenerateMediaCopyResponse | null,
  result: GenerateMediaCopyResult | undefined
): string | null => {
  if (
    !response ||
    response.status === 'failed' ||
    !result ||
    result.origin !== 'generated' ||
    !result.draft?.trim()
  )
    return 'No valid AI-generated caption; use Customize.';
  // No-speech videos may have grounded visual evidence. Other warnings require review.
  const warnings = [
    ...response.warnings.filter(
      (warning) =>
        ![
          'PLATFORM_GENERATION_FAILED',
          'IMAGE_PLAN_GENERATION_FAILED',
        ].includes(warning.code)
    ),
    ...result.warnings,
  ];
  if (
    warnings.some((warning) => warning.code !== 'NO_TRANSCRIPT') ||
    (warnings.some((warning) => warning.code === 'NO_TRANSCRIPT') &&
      !(
        response.sourceConfidence !== null && response.sourceConfidence >= 0.55
      ))
  ) {
    return 'Generated content needs individual review; use Customize.';
  }
  return null;
};

export const quickUploadProviderReason = (
  post: any,
  sourceMediaId?: string
): string | null => {
  if (post.valid !== true)
    return 'Required platform settings are missing; use Customize.';
  if (post.errors !== true)
    return typeof post.errors === 'string'
      ? post.errors
      : 'Video or provider settings need review; use Customize.';
  if (
    post.values?.length !== 1 ||
    post.values[0]?.media?.length !== 1 ||
    post.values[0].media[0].id !== sourceMediaId
  )
    return 'This destination must use the single source video; use Customize.';
  if (!post.values[0].content?.trim())
    return 'No generated caption; use Customize.';
  return null;
};
