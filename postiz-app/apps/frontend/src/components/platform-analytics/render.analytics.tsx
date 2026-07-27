import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Integration } from '@prisma/client';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { ChartSocial } from '@gitroom/frontend/components/analytics/chart-social';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PlatformVideoGrid } from '@gitroom/frontend/components/platform-analytics/platform.video.grid';
import { storeIntegrationReturnRoute } from '@gitroom/frontend/components/launches/helpers/integration.return-route';

interface AnalyticsDataItem {
  label: string;
  data: Array<{ total: number | string; date: string }>;
  metricName?: string;
  seriesType?: 'time_series' | 'total_value' | 'range_total_snapshot';
  summaryType?: 'sum' | 'latest';
  average?: boolean;
  percentageChange?: number;
}

type AnalyticsIntegration = Integration & {
  identifier: string;
  internalId: string;
  canListMedia?: boolean;
  name: string;
};

const TrendIndicator: FC<{ value: number; average?: boolean }> = ({
  value,
  average,
}) => {
  if (value === 0) return null;

  const isPositive = value > 0;
  const displayValue = Math.abs(value).toFixed(1);

  return (
    <div
      className={`flex items-center gap-[4px] text-[13px] font-medium ${
        isPositive ? 'text-[#32d583]' : 'text-[#f97066]'
      }`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        className={isPositive ? '' : 'rotate-180'}
      >
        <path
          d="M6 2.5L10 7.5H2L6 2.5Z"
          fill="currentColor"
        />
      </svg>
      <span>
        {displayValue}
        {average ? 'pp' : '%'}
      </span>
    </div>
  );
};

const AnalyticsCard: FC<{
  item: AnalyticsDataItem;
  total: string | number;
  index: number;
  chartKey: string;
  isInstagram: boolean;
  isInstagramBusiness: boolean;
  isTotalsMode?: boolean;
}> = ({
  item,
  total,
  index,
  chartKey,
  isInstagram,
  isInstagramBusiness,
  isTotalsMode,
}) => {
  const colorVariants = ['purple', 'green', 'blue'] as const;
  const color = colorVariants[index % colorVariants.length];

  const hasDataPoints = item.data.length > 0;
  const isInstagramTotalOnly = isInstagram && !item.average;
  const isRangeSnapshot =
    isInstagramBusiness && item.seriesType === 'range_total_snapshot';

  return (
    <div className="group relative">
      <div
        className={`
          flex flex-col h-full
          bg-newTableHeader
          border border-newTableBorder
          rounded-[12px]
          overflow-hidden
          transition-all duration-200
          hover:border-ai
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[16px] pt-[14px] pb-[8px]">
          <div className="flex items-center gap-[10px]">
            <div
              className={`
                w-[8px] h-[8px] rounded-full
                ${color === 'purple' ? 'bg-[#612bd3]' : ''}
                ${color === 'green' ? 'bg-[#32d583]' : ''}
                ${color === 'blue' ? 'bg-[#1d9bf0]' : ''}
              `}
            />
            <span className="text-[15px] font-medium text-newTableText">
              {item.label}
            </span>
          </div>
          {!isTotalsMode && item.percentageChange !== undefined && (
            <TrendIndicator value={item.percentageChange} average={item.average} />
          )}
        </div>

        {/* Content */}
        {isTotalsMode ? (
          <div className="flex-1 flex items-center px-[16px] py-[32px]">
            <div className="text-[48px] leading-[56px] font-semibold tracking-tight">
              {total}
            </div>
          </div>
        ) : hasDataPoints ? (
          <>
            {/* Chart */}
            <div className="flex-1 px-[12px] py-[8px]">
              <div className="h-[120px] relative">
                <ChartSocial
                  data={item.data}
                  color={color}
                  directPoints={true}
                  key={chartKey}
                />
              </div>
            </div>

            {/* Value */}
            <div className="px-[16px] pb-[14px]">
              <div className="text-[36px] leading-[42px] font-semibold tracking-tight">
                {total}
              </div>
              {isRangeSnapshot && (
                <div className="mt-[4px] text-[12px] text-newTableText/50">
                  Total for selected range
                </div>
              )}
            </div>
          </>
        ) : (
          /* Single value display */
          <div className="flex-1 flex flex-col items-center justify-center py-[32px] px-[16px]">
            <div className="text-[48px] leading-[56px] font-semibold tracking-tight">
              {total}
            </div>
            <div className="mt-[6px] text-[13px] font-medium text-newTableText/70">
              {item.average
                ? 'Average'
                : isInstagram
                  ? 'Total from Instagram'
                  : 'Total'}
            </div>
            {isInstagramTotalOnly && (
              <div className="mt-[4px] text-[12px] text-newTableText/50 text-center">
                Daily graph unavailable for past dates
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyState: FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const t = useT();

  return (
    <div className="col-span-full flex flex-col items-center justify-center py-[48px] px-[24px] bg-newTableHeader border border-newTableBorder rounded-[12px]">
      <div className="w-[48px] h-[48px] mb-[16px] rounded-full bg-newBgLineColor flex items-center justify-center">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-ai"
        >
          <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path d="M12 8v4l2 2" />
        </svg>
      </div>
      <p className="text-[15px] text-newTableText text-center mb-[12px]">
        {t(
          'this_channel_needs_to_be_refreshed',
          'This channel needs to be refreshed to display analytics'
        )}
      </p>
      <button
        onClick={onRefresh}
        className="inline-flex items-center gap-[6px] px-[16px] py-[8px] text-[14px] font-medium text-white bg-btnPrimary hover:opacity-90 rounded-[8px] transition-opacity"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
        {t('refresh_channel', 'Refresh Channel')}
      </button>
    </div>
  );
};

export const RenderAnalytics: FC<{
  integration: AnalyticsIntegration;
  date: number;
  isTotalsMode?: boolean;
}> = (props) => {
  const { integration, date, isTotalsMode } = props;
  const [loading, setLoading] = useState(true);
  const [showRefreshPrompt, setShowRefreshPrompt] = useState(false);
  const [refreshPromptCycle, setRefreshPromptCycle] = useState(0);
  const refreshPromptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetch = useFetch();

  const loadAnalytics = useCallback(
    async (forceRefresh = false) => {
      const refresh = forceRefresh ? '&refresh=true' : '';
      return (
        await fetch(`/analytics/${integration.id}?date=${date}${refresh}`)
      ).json();
    },
    [fetch, integration.id, date]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      return loadAnalytics();
    } finally {
      setLoading(false);
    }
  }, [loadAnalytics]);

  const { data, mutate } = useSWR(`/analytics-${integration?.id}-${date}`, load, {
    refreshInterval: 0,
    refreshWhenHidden: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    revalidateOnMount: true,
  });

  const refreshChannel = useCallback(
    (integrationData: AnalyticsIntegration) =>
      async () => {
        const { url } = await (
          await fetch(
            `/integrations/social/${integrationData.identifier}?refresh=${integrationData.internalId}`,
            {
              method: 'GET',
            }
          )
        ).json();
        storeIntegrationReturnRoute();
        window.location.href = url;
      },
    [fetch]
  );

  const t = useT();
  const isInstagram =
    integration.identifier === 'instagram' ||
    integration.identifier === 'instagram-standalone';
  const isInstagramBusiness = integration.identifier === 'instagram';

  useEffect(() => {
    if (!isInstagramBusiness) {
      setShowRefreshPrompt(false);
      return;
    }

    const clearRefreshPromptTimer = () => {
      if (refreshPromptTimer.current) {
        clearTimeout(refreshPromptTimer.current);
        refreshPromptTimer.current = null;
      }
    };

    const startRefreshPromptTimer = () => {
      clearRefreshPromptTimer();

      if (document.visibilityState !== 'visible') {
        return;
      }

      refreshPromptTimer.current = setTimeout(() => {
        setShowRefreshPrompt(true);
      }, 15 * 60 * 1000);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startRefreshPromptTimer();
      } else {
        clearRefreshPromptTimer();
        setShowRefreshPrompt(false);
      }
    };

    startRefreshPromptTimer();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearRefreshPromptTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isInstagramBusiness, integration.id, date, refreshPromptCycle]);

  const refreshAnalytics = useCallback(async () => {
    setLoading(true);
    setShowRefreshPrompt(false);
    try {
      const refreshed = await loadAnalytics(true);
      await mutate(refreshed, false);
    } finally {
      setLoading(false);
      setRefreshPromptCycle((current) => current + 1);
    }
  }, [loadAnalytics, mutate]);

  const totals = useMemo(() => {
    return data?.map((p: AnalyticsDataItem) => {
      if (p.summaryType === 'latest') {
        const latest = p.data[p.data.length - 1];
        return new Intl.NumberFormat().format(
          Math.round(Number(latest?.total || 0))
        );
      }

      const value =
        (p?.data.reduce(
          (acc: number, curr: { total: number | string }) =>
            acc + Number(curr.total || 0),
          0
        ) || 0) /
        (p.average ? p.data.length : 1);
      if (p.average) {
        return value.toFixed(2) + '%';
      }
      return new Intl.NumberFormat().format(Math.round(value));
    });
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[48px]">
        <LoadingComponent />
      </div>
    );
  }

  return (
    <>
      {isInstagramBusiness && (
        <div className="mb-[12px] rounded-[8px] border border-newTableBorder bg-newTableHeader px-[14px] py-[10px] text-[13px] text-newTableText/70">
          {t(
            'instagram_business_snapshot_note',
            'Reach comes from Meta daily data. Other Instagram Business metrics use saved range-total snapshots from the days you open or refresh analytics.'
          )}
        </div>
      )}
      {isInstagramBusiness && showRefreshPrompt && (
        <div className="mb-[12px] flex items-center justify-between gap-[12px] rounded-[8px] border border-newTableBorder bg-newTableHeader px-[14px] py-[10px]">
          <span className="text-[13px] text-newTableText/70">
            {t(
              'analytics_may_have_changed',
              'Analytics may have changed. Refresh?'
            )}
          </span>
          <button
            onClick={refreshAnalytics}
            className="shrink-0 rounded-[6px] bg-btnPrimary px-[12px] py-[6px] text-[13px] font-medium text-white hover:opacity-90"
          >
            {t('refresh', 'Refresh')}
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[16px]">
        {data?.length === 0 && (
          <EmptyState onRefresh={refreshChannel(integration)} />
        )}
        {data?.map((item: AnalyticsDataItem, index: number) => (
          <AnalyticsCard
            key={`analytics-${index}`}
            item={item}
            total={totals[index]}
            index={index}
            chartKey={`chart-${integration.id}-${date}-${item.label}-${index}`}
            isInstagram={isInstagram}
            isInstagramBusiness={isInstagramBusiness}
            isTotalsMode={isTotalsMode}
          />
        ))}
      </div>
      <PlatformVideoGrid integration={integration} />
    </>
  );
};
