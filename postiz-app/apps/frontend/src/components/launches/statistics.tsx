'use client';

import React, { FC, Fragment, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ChartSocial } from '@gitroom/frontend/components/analytics/chart-social';
import { Select } from '@gitroom/react/form/select';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { MissingReleaseModal } from '@gitroom/frontend/components/launches/missing-release.modal';

interface AnalyticsData {
  label: string;
  data: Array<{ total: number; date: string }>;
  percentageChange: number;
  average?: boolean;
}

export interface PreviewPostMetrics {
  likes?: number;
  reactions?: number;
  comments?: number;
  views?: number;
  shares?: number;
  saves?: number;
  reach?: number;
}

const previewMetricLabels: Record<string, keyof PreviewPostMetrics> = {
  likes: 'likes',
  likecount: 'likes',
  comments: 'comments',
  commentcount: 'comments',
  views: 'views',
  viewcount: 'views',
  shares: 'shares',
  sharecount: 'shares',
  saves: 'saves',
  saved: 'saves',
  savecount: 'saves',
  reach: 'reach',
  reactions: 'reactions',
  reactioncount: 'reactions',
  totalreactions: 'reactions',
  postreactions: 'reactions',
};

const normalizePreviewMetricLabel = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]/g, '');

const getPreviewMetricValue = (metric: AnalyticsData) => {
  const values = (metric.data || [])
    .map((item) => Number(item.total))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return undefined;
  }

  const total = values.reduce((acc, value) => acc + value, 0);
  return Math.round(metric.average ? total / values.length : total);
};

const normalizePreviewPostMetrics = (
  data?: AnalyticsData[] | { missing?: true }
): PreviewPostMetrics => {
  if (!Array.isArray(data)) {
    return {};
  }

  return data.reduce<PreviewPostMetrics>((acc, metric) => {
    const key = previewMetricLabels[normalizePreviewMetricLabel(metric.label)];
    const value = getPreviewMetricValue(metric);

    if (!key || typeof value !== 'number' || typeof acc[key] === 'number') {
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {});
};

export const formatPreviewMetric = (value: number) =>
  new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

export const usePostPreviewMetrics = (postId?: string): PreviewPostMetrics => {
  const fetch = useFetch();
  const loadPostAnalytics = useCallback(async () => {
    if (!postId) {
      return [];
    }

    return (await fetch(`/analytics/post/${postId}?date=7`)).json();
  }, [postId, fetch]);

  const { data } = useSWR<AnalyticsData[] | { missing?: true }>(
    postId ? `/analytics/post/${postId}?date=7` : null,
    loadPostAnalytics,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      revalidateOnMount: true,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    }
  );

  return useMemo(() => normalizePreviewPostMetrics(data), [data]);
};

interface PublishedComment {
  id: string;
  message: string;
  authorName: string;
  createdTime: string;
  likeCount: number;
  replyCount: number;
  permalinkUrl: string;
  hidden?: boolean;
  canReply?: boolean;
  canHide?: boolean;
  canDelete?: boolean;
}

interface PublishedCommentsResponse {
  supported: boolean;
  comments: PublishedComment[];
  missing?: boolean;
  reconnectRequired?: boolean;
  message?: string;
}

const getResponseErrorMessage = async (
  response: Response,
  fallback: string
) => {
  try {
    const body = await response.json();
    const message = body?.message || body?.error;

    if (Array.isArray(message)) {
      return message.join(' ');
    }

    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  } catch (err) {}

  return fallback;
};

export const PostStatisticsPanel: FC<{
  postId: string;
  isPublished?: boolean;
  hideWhenEmpty?: boolean;
  compact?: boolean;
}> = (props) => {
  const {
    postId,
    isPublished = true,
    hideWhenEmpty = false,
    compact = false,
  } = props;
  const t = useT();
  const fetch = useFetch();
  const [dateRange, setDateRange] = useState(7);
  const [commentReplies, setCommentReplies] = useState<Record<string, string>>(
    {}
  );
  const [commentAction, setCommentAction] = useState<{
    commentId: string;
    action: 'reply' | 'hide' | 'delete';
  } | null>(null);
  const [commentsError, setCommentsError] = useState('');

  const loadStatistics = useCallback(async () => {
    return (await fetch(`/posts/${postId}/statistics`)).json();
  }, [postId, fetch]);

  const loadPostAnalytics = useCallback(async () => {
    return (await fetch(`/analytics/post/${postId}?date=${dateRange}`)).json();
  }, [postId, dateRange, fetch]);

  const loadPostComments = useCallback(async () => {
    const response = await fetch(`/analytics/post/${postId}/comments`);

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(
          response,
          t('failed_to_load_comments', 'Failed to load comments.')
        )
      );
    }

    return response.json();
  }, [postId, fetch, t]);

  const { data: statisticsData, isLoading: isLoadingStatistics } = useSWR(
    `/posts/${postId}/statistics`,
    loadStatistics
  );

  const {
    data: analyticsData,
    isLoading: isLoadingAnalytics,
    mutate: mutateAnalytics,
  } = useSWR(`/analytics/post/${postId}?date=${dateRange}`, loadPostAnalytics, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });

  const {
    data: commentsData,
    isLoading: isLoadingComments,
    error: commentsLoadError,
    mutate: mutateComments,
  } =
    useSWR<PublishedCommentsResponse>(
      `/analytics/post/${postId}/comments`,
      loadPostComments,
      {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateIfStale: false,
        revalidateOnMount: true,
        refreshWhenHidden: false,
        refreshWhenOffline: false,
      }
    );

  const runCommentAction = useCallback(
    async (comment: PublishedComment, action: 'reply' | 'hide' | 'delete') => {
      const replyMessage = (commentReplies[comment.id] || '').trim();

      if (action === 'reply' && !replyMessage) {
        setCommentsError(
          t('reply_message_required', 'Reply message is required.')
        );
        return;
      }

      setCommentAction({ commentId: comment.id, action });
      setCommentsError('');

      try {
        const response = await fetch(
          `/analytics/post/${postId}/comments/${comment.id}${
            action === 'reply' ? '/reply' : action === 'hide' ? '/hide' : ''
          }`,
          {
            method: action === 'delete' ? 'DELETE' : 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body:
              action === 'reply'
                ? JSON.stringify({ message: replyMessage })
                : action === 'hide'
                ? JSON.stringify({ hide: !comment.hidden })
                : undefined,
          }
        );

        if (!response.ok) {
          let message = t('comment_action_failed', 'Comment action failed.');

          message = await getResponseErrorMessage(response, message);

          throw new Error(message);
        }

        if (action === 'reply') {
          setCommentReplies((current) => ({
            ...current,
            [comment.id]: '',
          }));
        }

        await mutateComments();
      } catch (err) {
        setCommentsError(
          err instanceof Error
            ? err.message
            : t('comment_action_failed', 'Comment action failed.')
        );
      } finally {
        setCommentAction(null);
      }
    },
    [commentReplies, fetch, mutateComments, postId, t]
  );

  const isMissing =
    analyticsData && !Array.isArray(analyticsData) && analyticsData.missing;
  const commentsLoadErrorMessage =
    commentsLoadError instanceof Error
      ? commentsLoadError.message
      : commentsLoadError
      ? t('failed_to_load_comments', 'Failed to load comments.')
      : '';
  const hasAnalytics =
    analyticsData && Array.isArray(analyticsData) && analyticsData.length > 0;
  const hasShortLinks = !!statisticsData?.clicks?.length;
  const hasPlatformComments = !!commentsData?.comments?.length;
  const hasCommentsStatus =
    !!commentsData?.supported ||
    !!commentsData?.reconnectRequired ||
    !!commentsData?.message ||
    !!commentsLoadErrorMessage;
  const hasAnyInsights =
    !!hasAnalytics ||
    hasShortLinks ||
    hasPlatformComments ||
    !!isMissing ||
    !!commentsData?.reconnectRequired ||
    !!commentsData?.message ||
    !!commentsLoadErrorMessage;
  const showAnalyticsSection = !!hasAnalytics || isPublished || !hideWhenEmpty;
  const showCommentsSection =
    hasCommentsStatus || isPublished || !hideWhenEmpty;
  const showShortLinksSection = hasShortLinks || isPublished || !hideWhenEmpty;

  const dateOptions = useMemo(() => {
    return [
      { key: 7, value: t('7_days', '7 Days') },
      { key: 30, value: t('30_days', '30 Days') },
      { key: 90, value: t('90_days', '90 Days') },
    ];
  }, [t]);

  const totals = useMemo(() => {
    if (!analyticsData || !Array.isArray(analyticsData)) return [];
    return analyticsData.map((p: AnalyticsData) => {
      const value =
        (p?.data?.reduce(
          (acc: number, curr: any) => acc + Number(curr.total),
          0
        ) || 0) / (p.average ? p.data.length : 1);
      if (p.average) {
        return value.toFixed(2) + '%';
      }
      return Math.round(value);
    });
  }, [analyticsData]);

  const isLoading = isLoadingStatistics || isLoadingAnalytics;

  if (hideWhenEmpty && !isPublished && !hasAnyInsights) {
    return null;
  }

  return (
    <div className="relative min-h-[200px]">
      {isLoading ? (
        <div className="flex items-center justify-center py-[40px]">
          <LoadingComponent />
        </div>
      ) : isMissing ? (
        <MissingReleaseModal
          postId={postId}
          onSuccess={() => mutateAnalytics()}
        />
      ) : (
        <div className="flex flex-col gap-[24px]">
          {showAnalyticsSection && (
            <div className="flex flex-col gap-[14px]">
              <div className="flex items-center justify-between gap-[12px]">
                <h3 className="text-[18px] font-[500]">
                  {t('post_analytics', 'Post analytics')}
                </h3>
                <div className="max-w-[150px]">
                  <Select
                    label=""
                    name="date"
                    disableForm={true}
                    hideErrors={true}
                    value={dateRange}
                    onChange={(e) => setDateRange(+e.target.value)}
                  >
                    {dateOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.value}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              {hasAnalytics ? (
                <div
                  className={`grid gap-[16px] ${
                    compact
                      ? 'grid-cols-1'
                      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                  }`}
                >
                  {analyticsData.map((p: AnalyticsData, index: number) => {
                    const colorVariants = ['purple', 'green', 'blue'] as const;
                    const color = colorVariants[index % colorVariants.length];
                    return (
                      <div key={`analytics-${index}`} className="group">
                        <div className="flex flex-col h-full bg-newTableHeader border border-newTableBorder rounded-[12px] overflow-hidden transition-all duration-200 hover:border-[#612bd3]/50">
                          <div className="flex items-center justify-between px-[16px] pt-[14px] pb-[8px]">
                            <div className="flex items-center gap-[10px]">
                              <div
                                className={`w-[8px] h-[8px] rounded-full ${
                                  color === 'purple' ? 'bg-[#612bd3]' : ''
                                } ${color === 'green' ? 'bg-[#32d583]' : ''} ${
                                  color === 'blue' ? 'bg-[#1d9bf0]' : ''
                                }`}
                              />
                              <span className="text-[15px] font-medium text-newTableText">
                                {p.label}
                              </span>
                            </div>
                          </div>
                          <div className="flex-1 px-[12px] py-[8px]">
                            <div className="h-[120px] relative">
                              <ChartSocial
                                data={p.data}
                                color={color}
                                key={`chart-${index}`}
                              />
                            </div>
                          </div>
                          <div className="px-[16px] pb-[14px]">
                            <div className="text-[36px] leading-[42px] font-semibold tracking-tight">
                              {totals[index]}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-gray-400">
                  {t(
                    'no_post_analytics_available_yet',
                    'No post analytics available yet.'
                  )}
                </div>
              )}
            </div>
          )}

          {showCommentsSection && (
            <div className="flex flex-col gap-[14px]">
              <h3 className="text-[18px] font-[500]">
                {t('recent_platform_comments', 'Recent platform comments')}
              </h3>
              {isLoadingComments ? (
                <div className="flex items-center gap-[12px] rounded-[12px] border border-newTableBorder bg-newTableHeader px-[16px] py-[14px] text-gray-300">
                  <LoadingComponent />
                  <span>{t('loading_comments', 'Loading comments...')}</span>
                </div>
              ) : commentsLoadErrorMessage ? (
                <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-[16px] py-[14px] text-red-200">
                  {commentsLoadErrorMessage}
                </div>
              ) : commentsData?.reconnectRequired || commentsData?.message ? (
                <div className="rounded-[12px] border border-newTableBorder bg-newTableHeader px-[16px] py-[14px] text-gray-300">
                  {commentsData?.reconnectRequired
                    ? commentsData?.message ||
                      t(
                        'reconnect_this_channel_to_load_comments',
                        'Reconnect this channel to load comments'
                      )
                    : commentsData?.message}
                </div>
              ) : commentsData?.comments?.length ? (
                <div className="flex flex-col gap-[12px]">
                  {!!commentsError && (
                    <div className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-[12px] py-[10px] text-[13px] text-red-200">
                      {commentsError}
                    </div>
                  )}
                  {commentsData?.comments?.map((comment: PublishedComment) => {
                    const canReply = comment.canReply === true;
                    const canHide = comment.canHide === true;
                    const canDelete = comment.canDelete === true;
                    const isReplying =
                      commentAction?.commentId === comment.id &&
                      commentAction.action === 'reply';
                    const isHiding =
                      commentAction?.commentId === comment.id &&
                      commentAction.action === 'hide';
                    const isDeleting =
                      commentAction?.commentId === comment.id &&
                      commentAction.action === 'delete';
                    const hasManagementControls =
                      canReply || canHide || canDelete;

                    return (
                      <div
                        key={comment.id}
                        className="rounded-[12px] border border-newTableBorder bg-newTableHeader px-[16px] py-[14px]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-[8px]">
                          <div className="text-[15px] font-medium text-newTableText">
                            {comment.authorName}
                          </div>
                          <div className="flex flex-wrap items-center gap-[8px] text-[12px] text-gray-400">
                            {typeof comment.hidden === 'boolean' && (
                              <span>
                                {comment.hidden
                                  ? t('hidden', 'Hidden')
                                  : t('visible', 'Visible')}
                              </span>
                            )}
                            <span>
                              {comment.createdTime
                                ? new Date(comment.createdTime).toLocaleString()
                                : ''}
                            </span>
                          </div>
                        </div>
                        <div className="mt-[10px] whitespace-pre-wrap text-[14px] text-gray-200">
                          {comment.message ||
                            t('no_comment_text', 'No comment text')}
                        </div>
                        <div className="mt-[12px] flex flex-wrap items-center gap-[12px] text-[12px] text-gray-400">
                          <span>
                            {t('likes', 'Likes')}: {comment.likeCount}
                          </span>
                          <span>
                            {t('replies', 'Replies')}: {comment.replyCount}
                          </span>
                          {!!comment.permalinkUrl && (
                            <a
                              href={comment.permalinkUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#7aa2ff] hover:text-[#9db9ff]"
                            >
                              {t('open_comment', 'Open comment')}
                            </a>
                          )}
                        </div>
                        {hasManagementControls && (
                          <div className="mt-[14px] flex flex-col gap-[10px]">
                            {canReply && (
                              <div className="flex flex-col gap-[8px] sm:flex-row">
                                <input
                                  value={commentReplies[comment.id] || ''}
                                  onChange={(event) =>
                                    setCommentReplies((current) => ({
                                      ...current,
                                      [comment.id]: event.target.value,
                                    }))
                                  }
                                  disabled={!!commentAction}
                                  placeholder={t(
                                    'write_a_reply',
                                    'Write a reply'
                                  )}
                                  className="min-h-[38px] flex-1 rounded-[8px] border border-newTableBorder bg-customColor6 px-[12px] text-[14px] text-newTableText outline-none"
                                />
                                <button
                                  type="button"
                                  disabled={
                                    !!commentAction ||
                                    !(commentReplies[comment.id] || '').trim()
                                  }
                                  onClick={() =>
                                    runCommentAction(comment, 'reply')
                                  }
                                  className="min-h-[38px] rounded-[8px] bg-[#612bd3] px-[14px] text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isReplying
                                    ? t('replying', 'Replying...')
                                    : t('reply', 'Reply')}
                                </button>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-[8px]">
                              {canHide && (
                                <button
                                  type="button"
                                  disabled={!!commentAction}
                                  onClick={() =>
                                    runCommentAction(comment, 'hide')
                                  }
                                  className="min-h-[34px] rounded-[8px] border border-newTableBorder px-[12px] text-[13px] text-newTableText disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isHiding
                                    ? t('saving', 'Saving...')
                                    : comment.hidden
                                    ? t('unhide', 'Unhide')
                                    : t('hide', 'Hide')}
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  type="button"
                                  disabled={!!commentAction}
                                  onClick={() =>
                                    runCommentAction(comment, 'delete')
                                  }
                                  className="min-h-[34px] rounded-[8px] border border-red-500/50 px-[12px] text-[13px] text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isDeleting
                                    ? t('deleting', 'Deleting...')
                                    : t('delete', 'Delete')}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-gray-400">
                  {t('no_platform_comments_yet', 'No platform comments yet.')}
                </div>
              )}
            </div>
          )}

          {showShortLinksSection && (
            <div className="flex flex-col gap-[14px]">
              <h3 className="text-[18px] font-[500]">
                {t('short_links_statistics', 'Short Links Statistics')}
              </h3>
              {!hasShortLinks ? (
                <div className="text-gray-400">
                  {t('no_short_link_results', 'No short link results')}
                </div>
              ) : (
                <div className="grid grid-cols-3 overflow-hidden rounded-t-lg">
                  <div className="bg-forth p-[4px] rounded-tl-lg">
                    {t('short_link', 'Short Link')}
                  </div>
                  <div className="bg-forth p-[4px]">
                    {t('original_link', 'Original Link')}
                  </div>
                  <div className="bg-forth p-[4px] rounded-tr-lg">
                    {t('clicks', 'Clicks')}
                  </div>
                  {statisticsData?.clicks?.map((p: any) => (
                    <Fragment key={p.short}>
                      <div className="p-[4px] py-[10px] bg-customColor6 break-words">
                        {p.short}
                      </div>
                      <div className="p-[4px] py-[10px] bg-customColor6 break-words">
                        {p.original}
                      </div>
                      <div className="p-[4px] py-[10px] bg-customColor6">
                        {p.clicks}
                      </div>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}

          {!showAnalyticsSection &&
            !showCommentsSection &&
            !showShortLinksSection && (
              <div className="text-center text-gray-400 py-[20px]">
                {t(
                  'no_statistics_available',
                  'No statistics available for this post'
                )}
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export const StatisticsModal: FC<{
  postId: string;
}> = ({ postId }) => {
  return <PostStatisticsPanel postId={postId} />;
};
