import type { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import type { Internal } from './store';
import { isGuidedMp4MovMedia } from './guided.video.validation';

export type GuidedRootMedia = Internal['integrationValue'][number]['media'];

export function getGuidedReviewMediaOverrides(
  media: GuidedRootMedia,
  sourceMediaId: string | null,
  destinations: Integrations[],
  internal: Internal[]
): Record<string, GuidedRootMedia> {
  const [video] = media;
  if (media.length !== 1 || video.id !== sourceMediaId || !isGuidedMp4MovMedia(video)) {
    return {};
  }

  const overrides: Record<string, GuidedRootMedia> = {};
  for (const { id, identifier } of destinations) {
    const isLinkedIn = identifier === 'linkedin' || identifier === 'linkedin-page';
    if (!isLinkedIn && identifier !== 'instagram' && identifier !== 'instagram-standalone') continue;

    const platformPost = internal.find((item) => item.integration.id === id);
    const customMedia = platformPost?.inheritRootMedia
      ? undefined
      : platformPost?.integrationValue[0]?.media;
    overrides[id] = customMedia ?? (isLinkedIn ? [] : [video]);
  }

  return overrides;
}
