'use client';

import React, { FC, useCallback } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { MediaPostReviewModal } from '@gitroom/frontend/components/new-launch/media.post.review.modal';
import { MediaCarouselReviewModal } from '@gitroom/frontend/components/new-launch/media.carousel.review.modal';
import { ReferenceImageLibrary } from '@gitroom/frontend/components/new-launch/reference.image.library';

const VIDEO_FILE_EXTENSION_PATTERN =
  /\.(?:mp4|m4v|mpeg|mpg|mpe|mov|qt|webm)(?:$|[?#])/i;

const isVideoMediaPath = (path?: string) =>
  Boolean(path && VIDEO_FILE_EXTENSION_PATTERN.test(path));

export const MediaCopyButton: FC<{
  media: { id: string; path: string }[];
  postIndex: number;
}> = ({ media, postIndex }) => {
  const t = useT();
  const modals = useModals();
  const firstMedia = media?.[0];
  const mediaType = isVideoMediaPath(firstMedia?.path) ? 'video' : 'image';

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
