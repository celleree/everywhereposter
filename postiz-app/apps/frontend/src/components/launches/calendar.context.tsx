'use client';

import 'reflect-metadata';
import {
  createContext,
  FC,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Post, Integration, Tags } from '@prisma/client';
import { usePathname, useSearchParams } from 'next/navigation';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { extend } from 'dayjs';
import useCookie from 'react-use-cookie';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { expandPostsList, expandPosts } from '@gitroom/helpers/utils/posts.list.minify';
import {
  CALENDAR_SHOW_IMPORTED_POSTS_EVENT,
  CALENDAR_SHOW_IMPORTED_POSTS_KEY,
  getShowImportedPostsInCalendar,
} from '@gitroom/frontend/components/launches/calendar-preferences';
extend(isoWeek);
extend(weekOfYear);

export type CalendarPost = Post & {
  integration: Integration;
  tags: {
    tag: Tags;
  }[];
  source?: 'historical';
  isHistoricalImport?: boolean;
  readOnly?: boolean;
  actualDate?: string;
  platformPostId?: string | null;
  platformPermalink?: string | null;
  postType?: string | null;
  mediaPreviewUrl?: string | null;
  thumbnailUrl?: string | null;
};

export const isHistoricalCalendarPost = (post?: Partial<CalendarPost> | null) =>
  post?.source === 'historical' ||
  post?.isHistoricalImport === true ||
  post?.readOnly === true;

let calendarMutationVersion = 0;

type CalendarReadSnapshot = {
  posts: CalendarPost[];
  comments?: Array<{ date: string; total: number }>;
  total?: number;
  rescheduleVersion: number;
};

type RescheduleAction = 'schedule' | 'update' | 'cancel';
type Reschedule = {
  date?: string;
  version?: number;
  phase: 'confirming' | 'saving' | 'reconciling' | 'saved' | 'unknown';
};

export const CalendarContext = createContext({
  startDate: newDayjs().startOf('isoWeek').format('YYYY-MM-DD'),
  endDate: newDayjs().endOf('isoWeek').format('YYYY-MM-DD'),
  customer: null as string | null,
  loading: true,
  sets: [] as { name: string; id: string; content: string[] }[],
  signature: undefined as any,
  comments: [] as Array<{
    date: string;
    total: number;
  }>,
  integrations: [] as (Integrations & {
    refreshNeeded?: boolean;
  })[],
  trendings: [] as string[],
  posts: [] as CalendarPost[],
  reloadCalendarView: () => {
    /** empty **/
  },
  display: 'week',
  setFilters: (filters: {
    startDate: string;
    endDate: string;
    display: 'week' | 'month' | 'day' | 'list';
    customer: string | null;
  }) => {
    /** empty **/
  },
  reschedulePost: async (
    _post: CalendarPost,
    _date: dayjs.Dayjs,
    _confirm?: () => Promise<RescheduleAction>
  ) => {},
  isRescheduling: (_id: string): boolean => false,
  // List view specific
  listPosts: [] as CalendarPost[],
  listPage: 0,
  listTotalPages: 0,
  isMobile: null as boolean | null,
  mobileTab: 'scheduled' as 'scheduled' | 'all',
  setMobileTab: (_tab: 'scheduled' | 'all') => {},
  mobileMonth: newDayjs().startOf('month').format('YYYY-MM-DD'),
  moveMobileMonth: (_months: number) => {},
  setMobileCustomer: (_customer: string | null) => {},
  mobilePosts: [] as CalendarPost[],
  mobilePage: 0,
  mobileTotalPages: 0,
  setMobilePage: (_page: number) => {},
  mobileLoading: true,
  mobileError: null as Error | null,
  retryMobile: () => {},
  setListPage: (page: number) => {
    /** empty **/
  },
});

export interface Integrations {
  name: string;
  id: string;
  disabled?: boolean;
  refreshNeeded?: boolean;
  inBetweenSteps: boolean;
  editor: 'none' | 'normal' | 'markdown' | 'html';
  display: string;
  identifier: string;
  type: string;
  picture: string;
  changeProfilePicture: boolean;
  additionalSettings: string;
  changeNickName: boolean;
  canListMedia?: boolean;
  publishedCapabilities?: {
    editMode: 'none' | 'metadata';
    canDeletePublished: boolean;
    reason?: string;
    requiresReconnect: boolean;
    constraints?: string[];
  };
  time: {
    time: number;
  }[];
  customer?: {
    name?: string;
    id?: string;
  };
}

// Helper function to get start and end dates based on display type
function getDateRange(display: string, referenceDate?: string) {
  const date = referenceDate ? newDayjs(referenceDate) : newDayjs();

  switch (display) {
    case 'day':
      return {
        startDate: date.format('YYYY-MM-DD'),
        endDate: date.format('YYYY-MM-DD'),
      };
    case 'week':
      return {
        startDate: date.startOf('isoWeek').format('YYYY-MM-DD'),
        endDate: date.endOf('isoWeek').format('YYYY-MM-DD'),
      };
    case 'month':
      return {
        startDate: date.startOf('month').format('YYYY-MM-DD'),
        endDate: date.endOf('month').format('YYYY-MM-DD'),
      };
    default:
      return {
        startDate: date.startOf('isoWeek').format('YYYY-MM-DD'),
        endDate: date.endOf('isoWeek').format('YYYY-MM-DD'),
      };
  }
}

export const CalendarWeekProvider: FC<{
  children: ReactNode;
  integrations: Integrations[];
}> = (props) => {
  const user = useUser();
  const pathname = usePathname();
  return (
    <CalendarProvider
      key={`${user?.id}:${user?.orgId}:${pathname}`}
      {...props}
      userId={user?.id}
      orgId={user?.orgId}
    />
  );
};

const CalendarProvider: FC<{
  children: ReactNode;
  integrations: Integrations[];
  userId?: string;
  orgId?: string;
}> = ({ children, integrations, userId, orgId }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const mounted = useRef(true);
  const version = useRef(calendarMutationVersion);
  const operations = useRef<Record<string, Reschedule>>({});
  const reads = useRef({ succeeded: 0, failed: 0 });
  const [reschedules, setReschedules] = useState<Record<string, Reschedule>>(
    {}
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const updateReschedule = useCallback((id: string, operation?: Reschedule) => {
    if (!mounted.current) return;
    if (operation) operations.current[id] = operation;
    else delete operations.current[id];
    setReschedules({ ...operations.current });
  }, []);
  // Each read keeps its start generation: an older cache or in-flight read must
  // not replace a newer optimistic date. Fresh reads remain authoritative.
  const loadPosts = useCallback(
    async (url: string, list = false): Promise<CalendarReadSnapshot> => {
      const readVersion = version.current;
      const pathname = window.location.pathname;
      let data;
      try {
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(
            list ? 'Unable to load scheduled posts' : 'Unable to load posts'
          );
        data = list
          ? expandPostsList(await response.json())
          : expandPosts(await response.json());
        reads.current.succeeded++;
      } catch (error) {
        reads.current.failed++;
        throw error;
      }
      if (mounted.current && window.location.pathname === pathname) {
        for (const [id, operation] of Object.entries(operations.current)) {
          if (
            operation.phase === 'unknown' &&
            operation.version! <= readVersion
          ) {
            updateReschedule(id, { ...operation, phase: 'saved' });
          }
        }
      }
      return { ...data, posts: data.posts, rescheduleVersion: readVersion };
    },
    [fetch, updateReschedule]
  );
  const overlay = useCallback(
    (data?: CalendarReadSnapshot): CalendarPost[] =>
      (data?.posts || []).map((post: CalendarPost) => {
        const operation = reschedules[post.id];
        return operation?.date &&
          (operation.version === undefined ||
            (data?.rescheduleVersion ?? -1) < operation.version)
          ? { ...post, publishDate: dayjs.utc(operation.date).toDate() }
          : post;
      }),
    [reschedules]
  );
  const isRescheduling = useCallback((id: string) => {
    const operation = operations.current[id];
    return !!operation && operation.phase !== 'saved';
  }, []);
  const [trendings] = useState<string[]>([]);
  const searchParams = useSearchParams();
  const [displaySaved, setDisplaySaved] = useCookie('calendar-display', 'week');
  const display = searchParams.get('display') || displaySaved;
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [mobileTab, setMobileTab] = useState<'scheduled' | 'all'>('scheduled');
  const [mobileMonth, setMobileMonth] = useState(() =>
    newDayjs().startOf('month').format('YYYY-MM-DD')
  );
  const [mobilePage, setMobilePage] = useState(0);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1025px)');
    const sync = () => setIsMobile(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const [showImportedPostsInCalendar, setShowImportedPostsInCalendarState] =
    useState(getShowImportedPostsInCalendar);

  // List view state
  const [listPage, setListPage] = useState(0);

  // Initialize with current date range based on URL params or defaults
  const initStartDate = searchParams.get('startDate');
  const initEndDate = searchParams.get('endDate');
  const initCustomer = searchParams.get('customer');

  const initialRange =
    initStartDate && initEndDate
      ? { startDate: initStartDate, endDate: initEndDate }
      : getDateRange(display);

  const [filters, setFilters] = useState({
    startDate: initialRange.startDate,
    endDate: initialRange.endDate,
    customer: initCustomer || null,
    display,
  });

  const params = useMemo(() => {
    return new URLSearchParams({
      display: filters.display,
      startDate: filters.startDate,
      endDate: filters.endDate,
      customer: filters?.customer?.toString() || '',
    }).toString();
  }, [filters]);

  // Calendar view data fetcher
  const loadData = useCallback(async () => {
    const modifiedParams = new URLSearchParams({
      display: filters.display,
      customer: filters?.customer?.toString() || '',
      startDate: newDayjs(filters.startDate).startOf('day').utc().format(),
      endDate: newDayjs(filters.endDate).endOf('day').utc().format(),
    }).toString();

    return loadPosts(`/posts?${modifiedParams}`);
  }, [filters, params, loadPosts]);

  // List view data fetcher
  const listParams = useMemo(() => {
    return new URLSearchParams({
      page: listPage.toString(),
      limit: '100',
      customer: filters?.customer?.toString() || '',
    }).toString();
  }, [listPage, filters.customer]);

  const loadListData = useCallback(async () => {
    return loadPosts(`/posts/list?${listParams}`, true);
  }, [listParams, loadPosts]);

  const mobileAllParams = useMemo(() => {
    const month = newDayjs(mobileMonth);
    return new URLSearchParams({
      customer: filters.customer || '',
      startDate: month.startOf('month').startOf('day').utc().format(),
      endDate: month.endOf('month').endOf('day').utc().format(),
    }).toString();
  }, [mobileMonth, filters.customer]);

  const scheduledParams = useMemo(
    () =>
      new URLSearchParams({
        mode: 'scheduled-once',
        page: mobilePage.toString(),
        limit: '100',
        customer: filters.customer || '',
      }).toString(),
    [mobilePage, filters.customer]
  );

  const loadMobileAll = useCallback(async () => {
    return loadPosts(`/posts?${mobileAllParams}`);
  }, [loadPosts, mobileAllParams]);

  const loadScheduled = useCallback(async () => {
    return loadPosts(`/posts/list?${scheduledParams}`, true);
  }, [loadPosts, scheduledParams]);

  // SWR for calendar view
  const {
    data: calendarData,
    isLoading: calendarIsLoading,
    mutate: mutateCalendar,
  } = useSWR(
    userId && orgId && isMobile === false && filters.display !== 'list'
      ? ['calendar-posts', userId, orgId, params]
      : null,
    loadData,
    {
      refreshInterval: 3600000,
      refreshWhenOffline: false,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
    }
  );

  // SWR for list view
  const {
    data: listData,
    isLoading: listIsLoading,
    mutate: mutateList,
  } = useSWR(
    userId && orgId && isMobile === false && filters.display === 'list'
      ? ['calendar-list', userId, orgId, listParams]
      : null,
    loadListData,
    {
      refreshInterval: 3600000,
      refreshWhenOffline: false,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
    }
  );

  const {
    data: mobileAllData,
    isLoading: mobileAllLoading,
    error: mobileAllError,
    mutate: mutateMobileAll,
  } = useSWR(
    userId && orgId && isMobile && mobileTab === 'all'
      ? ['calendar-mobile-all', userId, orgId, mobileAllParams]
      : null,
    loadMobileAll,
    { revalidateOnFocus: false }
  );
  const {
    data: scheduledData,
    isLoading: scheduledLoading,
    error: scheduledError,
    mutate: mutateScheduled,
  } = useSWR(
    userId && orgId && isMobile && mobileTab === 'scheduled'
      ? ['calendar-mobile-scheduled', userId, orgId, scheduledParams]
      : null,
    loadScheduled,
    { revalidateOnFocus: false }
  );

  const defaultSign = useCallback(async () => {
    return await (await fetch('/signatures/default')).json();
  }, []);

  const setList = useCallback(async () => {
    const response = await fetch('/sets');
    if (!response.ok) throw new Error('Unable to load sets');
    const rows = await response.json();
    if (
      !Array.isArray(rows) ||
      rows.some((row) => row?.organizationId !== orgId)
    ) {
      throw new Error('Unable to load sets');
    }
    return rows;
  }, [fetch, orgId]);

  const { data: sets } = useSWR(
    userId && orgId ? ['sets', userId, orgId] : null,
    setList,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      revalidateOnMount: true,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    }
  );
  const { data: sign } = useSWR('default-sign', defaultSign, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });

  const setFiltersWrapper = useCallback(
    (newFilters: {
      startDate: string;
      endDate: string;
      display: 'week' | 'month' | 'day' | 'list';
      customer: string | null;
    }) => {
      setDisplaySaved(newFilters.display);
      setFilters(newFilters);

      // Reset page when switching to list view
      if (newFilters.display === 'list') {
        setListPage(0);
      }

      const path = [
        `startDate=${newFilters.startDate}`,
        `endDate=${newFilters.endDate}`,
        `display=${newFilters.display}`,
        newFilters.customer ? `customer=${newFilters.customer}` : ``,
      ].filter((f) => f);
      window.history.replaceState(null, '', `/launches?${path.join('&')}`);
    },
    []
  );

  const setMobileCustomer = useCallback((customer: string | null) => {
    setFilters((current) => ({ ...current, customer: customer || null }));
    setMobilePage(0);
    const url = new URL(window.location.href);
    if (customer) url.searchParams.set('customer', customer);
    else url.searchParams.delete('customer');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const moveMobileMonth = useCallback((months: number) => {
    setMobileMonth((current) =>
      newDayjs(current).add(months, 'month').startOf('month').format('YYYY-MM-DD')
    );
  }, []);

  useEffect(() => {
    const syncPreference = (event?: Event) => {
      const showImportedPosts = (event as CustomEvent<{
        showImportedPosts?: boolean;
      }>)?.detail?.showImportedPosts;

      setShowImportedPostsInCalendarState(
        typeof showImportedPosts === 'boolean'
          ? showImportedPosts
          : getShowImportedPostsInCalendar()
      );
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === CALENDAR_SHOW_IMPORTED_POSTS_KEY) {
        syncPreference();
      }
    };

    window.addEventListener(CALENDAR_SHOW_IMPORTED_POSTS_EVENT, syncPreference);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(
        CALENDAR_SHOW_IMPORTED_POSTS_EVENT,
        syncPreference
      );
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const posts = useMemo(() => {
    const allPosts = overlay(calendarData);

    if (showImportedPostsInCalendar) {
      return allPosts;
    }

    return allPosts.filter(
      (post: CalendarPost) => !isHistoricalCalendarPost(post)
    );
  }, [calendarData, showImportedPostsInCalendar, overlay]);
  const mobileAllPosts = useMemo(() => {
    const allPosts = overlay(mobileAllData);
    return showImportedPostsInCalendar
      ? allPosts
      : allPosts.filter(
          (post: CalendarPost) => !isHistoricalCalendarPost(post)
        );
  }, [mobileAllData, showImportedPostsInCalendar, overlay]);
  const mobilePosts =
    mobileTab === 'scheduled' ? overlay(scheduledData) : mobileAllPosts;
  const mobileTotalPages = Math.ceil((scheduledData?.total || 0) / 100);

  useEffect(() => {
    if (scheduledData && mobilePage > 0 && mobilePage >= mobileTotalPages) {
      setMobilePage(Math.max(0, mobileTotalPages - 1));
    }
  }, [scheduledData, mobilePage, mobileTotalPages]);

  const retryMobile = useCallback(() => {
    if (mobileTab === 'scheduled') void mutateScheduled();
    else void mutateMobileAll();
  }, [mobileTab, mutateScheduled, mutateMobileAll]);

  const comments = useMemo(() => calendarData?.comments || [], [calendarData?.comments]);

  // List view data
  const listPosts = useMemo(() => overlay(listData), [listData, overlay]);
  const listTotal = listData?.total || 0;
  const listTotalPages = Math.ceil(listTotal / 100);

  const reconcile = useCallback(async () => {
    const before = { ...reads.current };
    const results = await Promise.allSettled([
      mutateCalendar(),
      mutateList(),
      mutateMobileAll(),
      mutateScheduled(),
    ]);
    // SWR revalidation can resolve with cached data after a fetcher error.
    return (
      reads.current.succeeded > before.succeeded &&
      reads.current.failed === before.failed &&
      results.every((result) => result.status === 'fulfilled')
    );
  }, [mutateCalendar, mutateList, mutateMobileAll, mutateScheduled]);

  const reloadCalendarView = useCallback(() => {
    void reconcile();
  }, [reconcile]);

  const reschedulePost = useCallback(
    async (
      post: CalendarPost,
      date: dayjs.Dayjs,
      confirm?: () => Promise<RescheduleAction>
    ) => {
      if (
        !userId ||
        !orgId ||
        !mounted.current ||
        isRescheduling(post.id) ||
        isHistoricalCalendarPost(post) ||
        post.state === 'DELETED_REMOTE'
      )
        return;
      // Acquire before opening a dialog or awaiting anything (same-tick drops).
      const previous = operations.current[post.id];
      updateReschedule(post.id, { ...previous, phase: 'confirming' });
      const location = window.location.href;
      const pathname = window.location.pathname;
      const active = () =>
        mounted.current && window.location.pathname === pathname;
      const current = () =>
        mounted.current && window.location.href === location;
      let action: RescheduleAction;
      try {
        action = confirm ? await confirm() : 'schedule';
      } catch {
        action = 'cancel';
      }
      if (!current() || action === 'cancel') {
        updateReschedule(post.id, previous);
        return;
      }
      const optimistic = !post.intervalInDays
        ? date.utc().format('YYYY-MM-DDTHH:mm:ss')
        : undefined;
      updateReschedule(post.id, { phase: 'saving', date: optimistic });
      let response: Response;
      try {
        response = await fetch(`/posts/${post.id}/date`, {
          method: 'PUT',
          body: JSON.stringify({
            date: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
            action,
          }),
        });
      } catch {
        if (!active()) return;
        updateReschedule(post.id, {
          phase: 'unknown',
          date: optimistic,
          version: (version.current = ++calendarMutationVersion),
        });
        const refreshed = await reconcile();
        if (current())
          toaster.show(
            refreshed
              ? t(
                  'reschedule_unconfirmed_refreshed',
                  'The save could not be confirmed. The calendar has been refreshed; check the date before trying again.'
                )
              : t(
                  'reschedule_unconfirmed',
                  'The save could not be confirmed. Refresh the calendar to check the date before trying again.'
                ),
            'warning'
          );
        return;
      }
      if (!active()) return;
      if (!response.ok) {
        updateReschedule(post.id, previous);
        if (current())
          toaster.show(
            t(
              'reschedule_failed',
              'The schedule could not be saved. The previous date has been restored.'
            ),
            'warning'
          );
        return;
      }
      updateReschedule(post.id, {
        phase: 'reconciling',
        date: optimistic,
        version: (version.current = ++calendarMutationVersion),
      });
      const refreshed = await reconcile();
      if (!active()) return;
      updateReschedule(post.id, {
        ...operations.current[post.id],
        phase: 'saved',
      });
      if (current())
        toaster.show(
          refreshed
            ? t('reschedule_saved', 'Schedule saved.')
            : t(
                'reschedule_saved_refresh_failed',
                'Schedule saved, but the calendar could not be refreshed. Refresh to check the latest posts.'
              ),
          refreshed ? 'success' : 'warning'
        );
    },
    [
      userId,
      orgId,
      isRescheduling,
      updateReschedule,
      fetch,
      reconcile,
      toaster,
      t,
    ]
  );

  // Determine loading state based on current view
  const loading = filters.display === 'list' ? listIsLoading : calendarIsLoading;

  return (
    <CalendarContext.Provider
      value={{
        trendings,
        reloadCalendarView,
        ...filters,
        posts: calendarIsLoading ? [] : posts,
        loading,
        integrations,
        setFilters: setFiltersWrapper,
        reschedulePost,
        isRescheduling,
        comments,
        sets: sets || [],
        signature: sign,
        // List view specific
        listPosts,
        listPage,
        listTotalPages,
        setListPage,
        isMobile,
        mobileTab,
        setMobileTab,
        mobileMonth,
        moveMobileMonth,
        setMobileCustomer,
        mobilePosts,
        mobilePage,
        mobileTotalPages,
        setMobilePage,
        mobileLoading: isMobile === null ||
          (mobileTab === 'scheduled' ? scheduledLoading : mobileAllLoading),
        mobileError: (mobileTab === 'scheduled' ? scheduledError : mobileAllError) || null,
        retryMobile,
      }}
    >
      {Object.values(reschedules).some(
        (operation) => operation.phase !== 'saved'
      ) && (
        <div role="status" className="p-2 text-sm">
          {Object.values(reschedules).some(
            (operation) => operation.phase === 'unknown'
          )
            ? t(
                'reschedule_check_needed',
                'Schedule unconfirmed. Refresh to check the latest date.'
              )
            : t('reschedule_pending', 'Updating schedule…')}
          <button
            type="button"
            onClick={reloadCalendarView}
            className="ms-2 underline"
          >
            {t('refresh', 'Refresh')}
          </button>
        </div>
      )}
      {children}
    </CalendarContext.Provider>
  );
};

export const useCalendar = () => useContext(CalendarContext);
