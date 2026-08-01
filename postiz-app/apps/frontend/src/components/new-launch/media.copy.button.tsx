'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { MediaPostReviewModal } from '@gitroom/frontend/components/new-launch/media.post.review.modal';
import { MediaCarouselReviewModal } from '@gitroom/frontend/components/new-launch/media.carousel.review.modal';
import { ReferenceImageLibrary } from '@gitroom/frontend/components/new-launch/reference.image.library';
import {
  isVideoMedia,
  MediaCopyItem,
  shouldHydrateMediaMetadata,
} from '@gitroom/frontend/components/new-launch/media.copy.helpers';

export const MediaCopyButton: FC<{
  media: MediaCopyItem[];
  postIndex: number;
}> = ({ media, postIndex }) => {
  const t = useT();
  const fetch = useFetch();
  const modals = useModals();
  const firstMedia = media?.[0];
  const [hydratedMedia, setHydratedMedia] = useState<MediaCopyItem>();

  useEffect(() => {
    let active = true;
    setHydratedMedia(undefined);

    if (!shouldHydrateMediaMetadata(firstMedia)) {
      return () => {
        active = false;
      };
    }

    void fetch(`/media/${encodeURIComponent(firstMedia!.id)}`)
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as MediaCopyItem | null;
        if (active && payload?.id === firstMedia!.id) {
          setHydratedMedia(payload);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [
    fetch,
    firstMedia?.id,
    firstMedia?.mimeType,
    firstMedia?.mimetype,
    firstMedia?.name,
    firstMedia?.originalName,
    firstMedia?.path,
    firstMedia?.type,
  ]);

  const resolvedMedia =
    hydratedMedia?.id === firstMedia?.id
      ? { ...firstMedia, ...hydratedMedia }
      : firstMedia;
  const mediaType = isVideoMedia(resolvedMedia) ? 'video' : 'image';

  const openModal = useCallback(() => {
    if (!firstMedia?.id) return;

    modals.openModal({
      title: t('generate_post_set', 'Generate Post Set'),
      size: 940,
      children: (close) => (
        <MediaPostReviewModal
          mediaId={firstMedia.id}
          mediaType={mediaType}
          postIndex={postIndex}
          onClose={close}
        />
      ),
    });
  }, [firstMedia?.id, mediaType, modals, postIndex, t]);

  const openCarouselModal = useCallback(() => {
    if (!firstMedia?.id || mediaType !== 'video') return;

    modals.openModal({
      title: t('generate_carousel', 'Generate Carousel'),
      size: 1080,
      children: (close) => (
        <MediaCarouselReviewModal
          mediaId={firstMedia.id}
          postIndex={postIndex}
          onClose={close}
        />
      ),
    });
  }, [firstMedia?.id, mediaType, modals, postIndex, t]);

  const openReferenceLibrary = useCallback(() => {
    modals.openModal({
      title: t('image_reference_library', 'Image Reference Library'),
      size: 1000,
      children: (close) => <ReferenceImageLibrary onClose={close} />,
    });
  }, [modals, t]);

  return (
    <div className="flex items-center gap-[6px]">
      <Button
        secondary
        className="!h-[30px] !px-[10px] text-[12px] rounded-[6px]"
        onClick={openReferenceLibrary}
      >
        {t('image_references', 'Image references')}
      </Button>
      <Button
        secondary
        className="!h-[30px] !px-[10px] text-[12px] rounded-[6px]"
        disabled={!firstMedia?.id}
        onClick={openModal}
      >
        {t('generate_post_set', 'Generate post set')}
      </Button>
      <Button
        secondary
        className="!h-[30px] !px-[10px] text-[12px] rounded-[6px]"
        disabled={!firstMedia?.id || mediaType !== 'video'}
        onClick={openCarouselModal}
      >
        {t('generate_carousel', 'Generate carousel')}
      </Button>
    </div>
  );
};
