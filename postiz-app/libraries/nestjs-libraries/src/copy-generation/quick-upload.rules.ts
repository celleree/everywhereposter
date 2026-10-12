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
  account: { disabled?: boolean; refreshNeeded?: boolean; publishedCapabilities?: { requiresReconnect?: boolean }; inBetweenSteps?: boolean; type?: string; identifier: string }
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
