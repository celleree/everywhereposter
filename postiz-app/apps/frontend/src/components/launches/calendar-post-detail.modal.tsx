'use client';

import React, { FC, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import {
  isHistoricalCalendarPost,
  type CalendarPost,
} from '@gitroom/frontend/components/launches/calendar.context';
import {
  PostStatisticsPanel,
  type PostStatisticsPanelSection,
} from '@gitroom/frontend/components/launches/statistics';
import { CommentsComponents } from '@gitroom/frontend/components/preview/comments.components';

type CalendarPostDetailTab =
  | 'overview'
  | 'analytics'
  | 'platformComments'
  | 'internalComments';

type CalendarPostDetailPost = CalendarPost;

const analyticsSections: PostStatisticsPanelSection[] = [
  'analytics',
  'shortLinks',
];

const platformCommentSections: PostStatisticsPanelSection[] = [
  'platformComments',
];

const formatState = (state: string) =>
  state
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const DetailRow: FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <div className="flex flex-col gap-[4px] border-b border-newTableBorder pb-[12px]">
    <div className="text-[12px] uppercase text-gray-400">{label}</div>
    <div className="text-[14px] text-newTableText">{value}</div>
  </div>
);

export const CalendarPostDetailModal: FC<{
  post: CalendarPostDetailPost;
  onEdit?: () => void;
}> = ({ post, onEdit }) => {
  const t = useT();
  const [tab, setTab] = useState<CalendarPostDetailTab>('overview');
  const isHistoricalPost = isHistoricalCalendarPost(post);
  const isRemoteDeleted = post.state === 'DELETED_REMOTE';
  const isPublished = post.state === 'PUBLISHED';
  const plainContent = useMemo(() => {
    return (
      stripHtmlValidation('none', post.content, false, true, false) ||
      t('no_content', 'No content')
    );
  }, [post.content, t]);

  const tags = useMemo(() => {
    return (
      post.tags
        ?.map((tag) => tag.tag.name)
        .filter(Boolean)
        .join(', ') || t('no_tags', 'No tags')
    );
  }, [post.tags, t]);

  const tabs = useMemo(
    () => [
      { key: 'overview' as const, label: t('overview', 'Overview') },
      ...(isHistoricalPost
        ? []
        : [
            { key: 'analytics' as const, label: t('analytics', 'Analytics') },
            {
              key: 'platformComments' as const,
              label: t('platform_comments', 'Platform Comments'),
            },
            {
              key: 'internalComments' as const,
              label: t(
                'internal_notes_team_comments',
                'Internal Notes / Team Comments'
              ),
            },
          ]),
    ],
    [isHistoricalPost, t]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px] border-b border-newTableBorder pb-[16px]">
        <div className="flex min-w-0 items-center gap-[12px]">
          <div className="relative h-[42px] w-[42px] flex-shrink-0">
            <img
              className="h-[42px] w-[42px] rounded-[8px]"
              src={post.integration.picture || '/no-picture.jpg'}
              alt={post.integration.name}
            />
            <img
              className="absolute bottom-[-2px] end-[-2px] z-10 h-[18px] w-[18px] rounded-[8px] border border-fifth"
              src={`/icons/platforms/${post.integration.providerIdentifier}.png`}
              alt={post.integration.providerIdentifier}
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[18px] font-[600] text-newTableText">
              {post.integration.name}
            </div>
            <div className="text-[13px] text-gray-400">
              {newDayjs(post.publishDate).local().format('MMM D, YYYY HH:mm')}
            </div>
          </div>
        </div>
        {!isHistoricalPost && onEdit && (
          <Button type="button" onClick={onEdit} disabled={isRemoteDeleted}>
            {t('edit_post', 'Edit Post')}
          </Button>
        )}
      </div>

      {!isHistoricalPost && (
        <div className="flex flex-wrap gap-[8px] border-b border-newTableBorder pb-[10px]">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={clsx(
                'rounded-[8px] px-[12px] py-[8px] text-[14px] transition-colors',
                tab === item.key
                  ? 'bg-btnPrimary text-white'
                  : 'bg-newTableHeader text-gray-300 hover:bg-tableBorder'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pe-[4px] scrollbar scrollbar-thumb-tableBorder scrollbar-track-secondary">
        {tab === 'overview' && (
          <div className="flex flex-col gap-[18px]">
            <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2">
              <DetailRow
                label={t('status', 'Status')}
                value={
                  isHistoricalPost
                    ? t('imported', 'Imported')
                    : formatState(post.state)
                }
              />
              <DetailRow
                label={t('channel', 'Channel')}
                value={post.integration.name}
              />
              <DetailRow
                label={t('platform', 'Platform')}
                value={post.integration.providerIdentifier}
              />
              <DetailRow label={t('tags', 'Tags')} value={tags} />
              <DetailRow
                label={t('platform_post_id', 'Platform Post ID')}
                value={post.platformPostId || post.releaseId || t('not_connected', 'Not connected')}
              />
              {isHistoricalPost && post.postType && (
                <DetailRow label={t('post_type', 'Post Type')} value={post.postType} />
              )}
              <DetailRow
                label={t('post_id', 'Post ID')}
                value={post.id}
              />
            </div>

            {isHistoricalPost && (post.thumbnailUrl || post.mediaPreviewUrl) && (
              <div className="flex flex-col gap-[8px]">
                <div className="text-[14px] font-[500] text-newTableText">
                  {t('media_preview', 'Media Preview')}
                </div>
                <img
                  className="max-h-[260px] max-w-full rounded-[8px] border border-newTableBorder object-contain"
                  src={post.thumbnailUrl || post.mediaPreviewUrl || ''}
                  alt={t('media_preview', 'Media Preview')}
                />
              </div>
            )}

            <div className="flex flex-col gap-[8px]">
              <div className="text-[14px] font-[500] text-newTableText">
                {t('content', 'Content')}
              </div>
              <div className="whitespace-pre-wrap rounded-[8px] border border-newTableBorder bg-newTableHeader p-[14px] text-[14px] text-gray-200">
                {plainContent}
              </div>
            </div>
          </div>
        )}

        {!isHistoricalPost && tab === 'analytics' && (
          <PostStatisticsPanel
            postId={post.id}
            isPublished={isPublished}
            sections={analyticsSections}
          />
        )}

        {!isHistoricalPost && tab === 'platformComments' && (
          <PostStatisticsPanel
            postId={post.id}
            isPublished={isPublished}
            sections={platformCommentSections}
          />
        )}

        {!isHistoricalPost && tab === 'internalComments' && (
          <div className="flex flex-col gap-[14px]">
            <h3 className="text-[18px] font-[500]">
              {t(
                'internal_notes_team_comments',
                'Internal Notes / Team Comments'
              )}
            </h3>
            <CommentsComponents postId={post.id} />
          </div>
        )}
      </div>
    </div>
  );
};
