'use client';

import React, { FC, useCallback } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { MediaPostReviewModal } from '@gitroom/frontend/components/new-launch/media.post.review.modal';

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

  return (
    <Button
      secondary
      className="!h-[30px] !px-[10px] text-[12px] rounded-[6px]"
      disabled={!firstMedia?.id}
      onClick={openModal}
    >
      {t('generate_post_set', 'Generate post set')}
    </Button>
  );
};