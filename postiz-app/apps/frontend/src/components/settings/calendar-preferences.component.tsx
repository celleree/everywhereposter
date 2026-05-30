'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Slider } from '@gitroom/react/form/slider';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import {
  getShowImportedPostsInCalendar,
  setShowImportedPostsInCalendar,
} from '@gitroom/frontend/components/launches/calendar-preferences';

type IntegrationListItem = {
  id: string;
  identifier: string;
  canListMedia?: boolean;
  disabled?: boolean;
  refreshNeeded?: boolean;
  inBetweenSteps?: boolean;
};

type HistoricalImportSummary = {
  postsCreated?: number;
  postsUpdated?: number;
  postsSkipped?: number;
};

const getResponseErrorMessage = async (
  response: Response,
  fallback: string
) => {
  try {
    const raw = await response.text();
    if (!raw) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(raw);
      const message = parsed?.message || parsed?.error;
      return Array.isArray(message) ? message.join(', ') : message || raw;
    } catch {
      return raw;
    }
  } catch {
    return fallback;
  }
};

const CalendarPreferencesComponent = () => {
  const t = useT();
  const toaster = useToaster();
  const fetch = useFetch();
  const [showImportedPosts, setShowImportedPosts] = useState(
    getShowImportedPostsInCalendar
  );
  const [isImportingHistoricalPosts, setIsImportingHistoricalPosts] =
    useState(false);

  const loadIntegrations = useCallback(
    async (path: string) => {
      return ((await (await fetch(path)).json()).integrations ||
        []) as IntegrationListItem[];
    },
    [fetch]
  );

  const { data: integrations = [] } = useSWR(
    '/integrations/list',
    loadIntegrations,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      revalidateOnMount: true,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      fallbackData: [],
    }
  );

  const eligibleInstagramIntegrations = useMemo(() => {
    return integrations.filter((integration) => {
      return (
        integration.identifier === 'instagram' &&
        integration.canListMedia &&
        !integration.disabled &&
        !integration.refreshNeeded &&
        !integration.inBetweenSteps
      );
    });
  }, [integrations]);

  const handleShowImportedPostsChange = useCallback(
    (value: 'on' | 'off') => {
      const enabled = value === 'on';
      setShowImportedPosts(enabled);
      setShowImportedPostsInCalendar(enabled);
      toaster.show(t('settings_updated', 'Settings updated'), 'success');
    },
    [toaster, t]
  );

  const importInstagramPosts = useCallback(async () => {
    if (
      isImportingHistoricalPosts ||
      eligibleInstagramIntegrations.length === 0
    ) {
      return;
    }

    setIsImportingHistoricalPosts(true);

    try {
      const summaries = await Promise.all(
        eligibleInstagramIntegrations.map(async (integration) => {
          const response = await fetch(
            `/integrations/${integration.id}/historical-import/backfill`,
            {
              method: 'POST',
              body: JSON.stringify({ maxPages: 1 }),
            }
          );

          if (!response.ok) {
            throw new Error(
              await getResponseErrorMessage(
                response,
                t(
                  'failed_to_import_instagram_posts',
                  'Failed to import Instagram posts'
                )
              )
            );
          }

          return (await response.json()) as HistoricalImportSummary;
        })
      );

      const totals = summaries.reduce(
        (all, summary) => ({
          postsCreated: all.postsCreated + (summary.postsCreated || 0),
          postsUpdated: all.postsUpdated + (summary.postsUpdated || 0),
          postsSkipped: all.postsSkipped + (summary.postsSkipped || 0),
        }),
        { postsCreated: 0, postsUpdated: 0, postsSkipped: 0 }
      );

      toaster.show(
        t(
          'instagram_import_complete_settings_summary',
          'Instagram import complete: {{created}} imported, {{updated}} updated, {{skipped}} skipped. Calendar will update after refresh or reopen.'
        )
          .replace('{{created}}', String(totals.postsCreated))
          .replace('{{updated}}', String(totals.postsUpdated))
          .replace('{{skipped}}', String(totals.postsSkipped)),
        'success'
      );
    } catch (error) {
      toaster.show(
        error instanceof Error
          ? error.message
          : t(
              'failed_to_import_instagram_posts',
              'Failed to import Instagram posts'
            ),
        'warning'
      );
    } finally {
      setIsImportingHistoricalPosts(false);
    }
  }, [
    eligibleInstagramIntegrations,
    fetch,
    isImportingHistoricalPosts,
    t,
    toaster,
  ]);

  return (
    <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[24px]">
      <div className="mt-[4px]">
        {t('calendar_settings', 'Calendar Settings')}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t(
              'show_imported_posts_in_calendar',
              'Show imported posts in Calendar'
            )}
          </div>
        </div>
        <Slider
          value={showImportedPosts ? 'on' : 'off'}
          onChange={handleShowImportedPostsChange}
          fill={true}
        />
      </div>
      {eligibleInstagramIntegrations.length > 0 && (
        <div className="flex items-center justify-between gap-[16px]">
          <div className="flex flex-col">
            <div className="text-[14px]">
              {t('import_instagram_posts', 'Import Instagram posts')}
            </div>
          </div>
          <button
            type="button"
            onClick={importInstagramPosts}
            disabled={isImportingHistoricalPosts}
            className={`rounded-[8px] border border-newTableBorder bg-newBgColorInner px-[12px] py-[10px] text-[14px] font-[500] transition-all ${
              isImportingHistoricalPosts
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:bg-boxFocused hover:text-textItemFocused'
            }`}
          >
            {isImportingHistoricalPosts
              ? t('importing', 'Importing...')
              : t('import_instagram_posts', 'Import Instagram posts')}
          </button>
        </div>
      )}
    </div>
  );
};

export default CalendarPreferencesComponent;
