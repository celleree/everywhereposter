'use client';

import React, { FC } from 'react';
import type { CaptionMode } from '@gitroom/nestjs-libraries/copy-generation/caption-modes';
import type { CopyPlatform } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';

const PLATFORM_LABELS: Record<CopyPlatform, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  threads: 'Threads',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  bluesky: 'Bluesky',
};

export const buildGuidedGenerationFingerprint = ({
  mediaId,
  destinations,
  captionMode,
  sourceCaption,
  additionalContext,
}: {
  mediaId?: string;
  destinations: Array<{ id: string; identifier: string }>;
  captionMode: CaptionMode;
  sourceCaption: string;
  additionalContext: string;
}) =>
  JSON.stringify({
    mediaId: mediaId || null,
    destinations: destinations
      .map(({ id, identifier }) => ({ id, identifier }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    captionMode,
    sourceCaption,
    additionalContext: additionalContext.trim(),
  });

export const getGuidedGenerationProgress = (name: string, data?: any) => {
  const platform = data?.platform as CopyPlatform | undefined;
  const platformLabel = platform ? PLATFORM_LABELS[platform] : undefined;

  if (name === 'copy-generation-started') {
    return 'Understanding the video';
  }
  if (name === 'platform-started' && platformLabel) {
    return `Generating ${platformLabel}`;
  }
  if (name === 'platform-rewrite-started' && platformLabel) {
    return `Refining ${platformLabel}`;
  }
  if (
    name === 'platform-complete' ||
    name === 'image-plan-started' ||
    name === 'image-plan-complete' ||
    name === 'completed'
  ) {
    return 'Finishing captions';
  }

  return 'Understanding the video';
};

export const GuidedComposerGeneration: FC<{ progress: string }> = ({
  progress,
}) => (
  <div className="flex min-h-full w-full items-center justify-center p-[40px] mobile:p-[18px]">
    <div
      role="status"
      aria-live="polite"
      className="w-full max-w-[560px] rounded-[20px] border border-ai/40 bg-newBgColorInner p-[32px] text-center mobile:rounded-[16px] mobile:p-[22px]"
    >
      <div
        aria-hidden="true"
        className="mx-auto h-[38px] w-[38px] animate-spin rounded-full border-[3px] border-newBorder border-t-ai"
      />
      <h2 className="mt-[18px] text-[20px] font-[700] text-white">
        {progress || 'Preparing your post set'}
      </h2>
      <p className="mx-auto mt-[8px] max-w-[420px] text-[13px] leading-[1.6] text-textColor/60">
        We’re adapting one caption for each selected platform. This can take a
        moment.
      </p>
    </div>
  </div>
);
