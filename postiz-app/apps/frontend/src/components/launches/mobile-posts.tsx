'use client';

import { Fragment, useMemo } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import {
  isHistoricalCalendarPost,
  type CalendarPost,
} from '@gitroom/frontend/components/launches/calendar.context';

// The calendar expands recurring roots into dated occurrences with a shared ID.
// Show each root once, without treating an occurrence as a verified next run.
export const consolidateMobileAllPosts = (posts: CalendarPost[]) => {
  const recurring = new Map<string, CalendarPost>();
  const ordinary: CalendarPost[] = [];
  for (const post of posts) {
    if (post.intervalInDays && post.intervalInDays > 0) {
      if (!recurring.has(post.id)) recurring.set(post.id, post);
    } else {
      ordinary.push(post);
    }
  }
  return {
    ordinary: ordinary.sort(
      (a, b) =>
        new Date(a.publishDate).getTime() - new Date(b.publishDate).getTime() ||
        a.id.localeCompare(b.id)
    ),
    recurring: [...recurring.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
};

export const MobilePostList = ({
  posts,
  scheduled,
  loading,
  error,
  retry,
  onDetails,
  onEdit,
  onDelete,
}: {
  posts: CalendarPost[];
  scheduled: boolean;
  loading: boolean;
  error: Error | null;
  retry: () => void;
  onDetails: (post: CalendarPost) => void;
  onEdit: (post: CalendarPost) => void;
  onDelete: (post: CalendarPost) => void;
}) => {
  const t = useT();
  const { ordinary, recurring } = useMemo(
    () =>
      scheduled
        ? { ordinary: posts, recurring: [] }
        : consolidateMobileAllPosts(posts),
    [posts, scheduled]
  );
  const groups = useMemo(() => {
    const byDate = new Map<string, CalendarPost[]>();
    for (const post of ordinary) {
      const date = newDayjs(post.publishDate).local().format('YYYY-MM-DD');
      byDate.set(date, [...(byDate.get(date) || []), post]);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [ordinary]);

  if (error)
    return (
      <div
        role="alert"
        className="flex flex-1 flex-col items-center justify-center gap-[12px] text-textColor"
      >
        <p>{t('posts_load_failed', 'Posts could not be loaded.')}</p>
        <button
          type="button"
          onClick={retry}
          className="min-h-[44px] rounded-[8px] bg-btnPrimary px-[20px] text-white"
        >
          {t('retry', 'Retry')}
        </button>
      </div>
    );
  if (loading)
    return (
      <div
        role="status"
        className="flex flex-1 items-center justify-center text-textColor"
      >
        {t('loading', 'Loading...')}
      </div>
    );
  if (ordinary.length === 0 && recurring.length === 0)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-[12px] text-center text-textColor">
        <p>
          {scheduled
            ? t(
                'no_one_time_scheduled_posts',
                'No one-time scheduled posts yet.'
              )
            : t('no_posts_in_month', 'No posts in this month.')}
        </p>
        {scheduled && (
          <Link
            href="/create"
            className="min-h-[44px] rounded-[8px] bg-btnPrimary px-[20px] py-[12px] text-white"
          >
            {t('create_post', 'Create post')}
          </Link>
        )}
      </div>
    );

  const card = (post: CalendarPost, repeat = false) => {
    const historical = isHistoricalCalendarPost(post);
    const originalDate = post.actualDate || post.publishDate;
    const content =
      stripHtmlValidation('none', post.content, false, true, false) ||
      t('no_content', 'No content');
    return (
      <article
        key={post.id}
        className="min-w-0 rounded-[12px] border border-newTableBorder bg-newColColor p-[12px] text-textColor"
      >
        <div className="flex min-w-0 items-start gap-[10px]">
          <div className="relative h-[36px] w-[36px] shrink-0">
            <img
              src={post.integration.picture || '/no-picture.jpg'}
              alt=""
              className="h-[36px] w-[36px] rounded-[8px]"
            />
            <img
              src={`/icons/platforms/${post.integration.providerIdentifier}.png`}
              alt=""
              className="absolute bottom-0 end-0 h-[15px] w-[15px] rounded-[4px] border border-newTableBorder"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-[600]">
              {post.integration.name} · {post.integration.providerIdentifier}
            </div>
            <div className="text-[12px] text-textColor/70">
              {repeat
                ? `${post.state} · ${t('repeat_configured', 'Repeat configured')} · ${t(
                    'original_date',
                    'Original date'
                  )}: ${newDayjs(originalDate).local().format('MMM D, YYYY')}`
                : newDayjs(post.publishDate).local().format('h:mm A')}
              {!scheduled &&
                !repeat &&
                ` · ${historical ? t('imported', 'Imported') : post.state}`}
            </div>
            <p className="mt-[6px] line-clamp-2 break-words text-[13px]">
              {content}
            </p>
          </div>
        </div>
        <div className="mt-[10px] flex flex-wrap gap-[8px]">
          <button
            type="button"
            onClick={() => onDetails(post)}
            aria-label={`${t('details', 'Details')}: ${post.integration.name}`}
            className="min-h-[44px] rounded-[8px] border border-newTableBorder px-[12px] text-[13px]"
          >
            {t('details', 'Details')}
          </button>
          {!historical && post.state !== 'DELETED_REMOTE' && (
            <button
              type="button"
              onClick={() => onEdit(post)}
              aria-label={`${t('edit_reschedule', 'Edit / Reschedule')}: ${
                post.integration.name
              }`}
              className="min-h-[44px] rounded-[8px] border border-newTableBorder px-[12px] text-[13px]"
            >
              {t('edit_reschedule', 'Edit / Reschedule')}
            </button>
          )}
          {!historical && (
            <button
              type="button"
              onClick={() => onDelete(post)}
              aria-label={`${
                post.state === 'PUBLISHED'
                  ? t('delete_on_platform', 'Delete on platform')
                  : t('delete_post', 'Delete post')
              }: ${post.integration.name}`}
              className="min-h-[44px] rounded-[8px] border border-newTableBorder px-[12px] text-[13px]"
            >
              {post.state === 'PUBLISHED'
                ? t('delete_on_platform', 'Delete on platform')
                : t('delete_post', 'Delete post')}
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="min-w-0 flex-1 overflow-y-auto pb-[96px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
      <div className="flex min-w-0 flex-col gap-[16px]">
        {groups.map(([date, datePosts]) => (
          <Fragment key={date}>
            <h2 className="text-[14px] font-[600] text-textColor">
              {newDayjs(date).format('dddd, MMMM D, YYYY')}
            </h2>
            <div className="flex min-w-0 flex-col gap-[10px]">
              {datePosts.map((post) => card(post))}
            </div>
          </Fragment>
        ))}
        {recurring.length > 0 && (
          <section className="flex min-w-0 flex-col gap-[10px]">
            <h2 className="text-[14px] font-[600] text-textColor">
              {t('repeat_configured', 'Repeat configured')}
            </h2>
            {recurring.map((post) => card(post, true))}
          </section>
        )}
      </div>
    </div>
  );
};
