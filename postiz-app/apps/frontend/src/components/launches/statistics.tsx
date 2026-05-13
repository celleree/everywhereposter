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
}

interface PublishedCommentsResponse {
  supported: boolean;
  comments: PublishedComment[];
  missing?: boolean;
  reconnectRequired?: boolean;
  message?: string;
}

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

  const loadStatistics = useCallback(async () => {
    return (await fetch(`/posts/${postId}/statistics`)).json();
  }, [postId, fetch]);

  const loadPostAnalytics = useCallback(async () => {
    return (await fetch(`/analytics/post/${postId}?date=${dateRange}`)).json();
  }, [postId, dateRange, fetch]);

  const loadPostComments = useCallback(async () => {
    return (await fetch(`/analytics/post/${postId}/comments`)).json();
  }, [postId, fetch]);

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

  const { data: commentsData, isLoading: isLoadingComments } =
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

  const isMissing =
    analyticsData && !Array.isArray(analyticsData) && analyticsData.missing;
  const hasAnalytics =
    analyticsData && Array.isArray(analyticsData) && analyticsData.length > 0;
  const hasShortLinks = !!statisticsData?.clicks?.length;
  const hasPlatformComments = !!commentsData?.comments?.length;
  const hasCommentsStatus =
    !!commentsData?.supported ||
    !!commentsData?.reconnectRequired ||
    !!commentsData?.message;
  const hasAnyInsights =
    !!hasAnalytics ||
    hasShortLinks ||
    hasPlatformComments ||
    !!isMissing ||
    !!commentsData?.reconnectRequired ||
    !!commentsData?.message;
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

  const isLoading =
    isLoadingStatistics || isLoadingAnalytics || isLoadingComments;

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
              {commentsData?.reconnectRequired || commentsData?.message ? (
                <div className="rounded-[12px] border border-newTableBorder bg-newTableHeader px-[16px] py-[14px] text-gray-300">
                  {commentsData?.reconnectRequired
                    ? t(
                        'reconnect_this_channel_to_load_comments',
                        'Reconnect this channel to load comments'
                      )
                    : commentsData?.message}
                </div>
              ) : commentsData?.comments?.length ? (
                <div className="flex flex-col gap-[12px]">
                  {commentsData?.comments?.map((comment: PublishedComment) => (
                    <div
                      key={comment.id}
                      className="rounded-[12px] border border-newTableBorder bg-newTableHeader px-[16px] py-[14px]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-[8px]">
                        <div className="text-[15px] font-medium text-newTableText">
                          {comment.authorName}
                        </div>
                        <div className="text-[12px] text-gray-400">
                          {comment.createdTime
                            ? new Date(comment.createdTime).toLocaleString()
                            : ''}
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
                    </div>
                  ))}
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
