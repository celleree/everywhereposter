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
  useState,
} from 'react';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Post, Integration, Tags } from '@prisma/client';
import { useSearchParams } from 'next/navigation';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { extend } from 'dayjs';
import useCookie from 'react-use-cookie';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { timer } from '@gitroom/helpers/utils/timer';
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
  changeDate: (id: string, date: dayjs.Dayjs) => {
    /** empty **/
  },
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
}> = ({ children, integrations }) => {
  const fetch = useFetch();
  const [internalData, setInternalData] = useState([] as any[]);
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

    const data = await (await fetch(`/posts?${modifiedParams}`)).json();
    return expandPosts(data);
  }, [filters, params]);

  // List view data fetcher
  const listParams = useMemo(() => {
    return new URLSearchParams({
      page: listPage.toString(),
      limit: '100',
      customer: filters?.customer?.toString() || '',
    }).toString();
  }, [listPage, filters.customer]);

  const loadListData = useCallback(async () => {
    const response = await fetch(`/posts/list?${listParams}`);
    return expandPostsList(await response.json());
  }, [listParams]);

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
    const response = await fetch(`/posts?${mobileAllParams}`);
    if (!response.ok) throw new Error('Unable to load posts');
    return expandPosts(await response.json());
  }, [fetch, mobileAllParams]);

  const loadScheduled = useCallback(async () => {
    const response = await fetch(`/posts/list?${scheduledParams}`);
    if (!response.ok) throw new Error('Unable to load scheduled posts');
    return expandPostsList(await response.json());
  }, [fetch, scheduledParams]);

  // SWR for calendar view
  const {
    data: calendarData,
    isLoading: calendarIsLoading,
    mutate: mutateCalendar,
  } = useSWR(
    isMobile === false && filters.display !== 'list' ? `/posts-${params}` : null,
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
    isMobile === false && filters.display === 'list' ? `/posts-list-${listParams}` : null,
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
    isMobile && mobileTab === 'all' ? `mobile-all-${mobileAllParams}` : null,
    loadMobileAll,
    { revalidateOnFocus: false }
  );
  const {
    data: scheduledData,
    isLoading: scheduledLoading,
    error: scheduledError,
    mutate: mutateScheduled,
  } = useSWR(
    isMobile && mobileTab === 'scheduled'
      ? `mobile-scheduled-${scheduledParams}`
      : null,
    loadScheduled,
    { revalidateOnFocus: false }
  );

  const defaultSign = useCallback(async () => {
    return await (await fetch('/signatures/default')).json();
  }, []);

  const setList = useCallback(async () => {
    return (await fetch('/sets')).json();
  }, []);

  const { data: sets, mutate } = useSWR('sets', setList, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
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
      setInternalData([]);

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
    const allPosts = calendarData?.posts || [];

    if (showImportedPostsInCalendar) {
      return allPosts;
    }

    return allPosts.filter((post: CalendarPost) => !isHistoricalCalendarPost(post));
  }, [calendarData?.posts, showImportedPostsInCalendar]);
  const mobileAllPosts = useMemo(() => {
    const allPosts = mobileAllData?.posts || [];
    return showImportedPostsInCalendar
      ? allPosts
      : allPosts.filter((post: CalendarPost) => !isHistoricalCalendarPost(post));
  }, [mobileAllData?.posts, showImportedPostsInCalendar]);
  const mobilePosts = mobileTab === 'scheduled'
    ? scheduledData?.posts || []
    : mobileAllPosts;
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
  const listPosts = useMemo(() => listData?.posts || [], [listData?.posts]);
  const listTotal = listData?.total || 0;
  const listTotalPages = Math.ceil(listTotal / 100);

  const changeDate = useCallback(
    (id: string, date: dayjs.Dayjs) => {
      setInternalData((d) =>
        d.map((post: Post) => {
          if (post.id === id) {
            return {
              ...post,
              publishDate: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
            };
          }
          return post;
        })
      );
    },
    [posts, internalData]
  );

  useEffect(() => {
    if (posts) {
      setInternalData(posts);
    }
  }, [posts]);

  // Combined reload function that handles both calendar and list views
  const reloadCalendarView = useCallback(() => {
    void mutateCalendar();
    void mutateList();
    void mutateMobileAll();
    void mutateScheduled();
  }, [mutateCalendar, mutateList, mutateMobileAll, mutateScheduled]);

  // Determine loading state based on current view
  const loading = filters.display === 'list' ? listIsLoading : calendarIsLoading;

  return (
    <CalendarContext.Provider
      value={{
        trendings,
        reloadCalendarView,
        ...filters,
        posts: calendarIsLoading ? [] : internalData,
        loading,
        integrations,
        setFilters: setFiltersWrapper,
        changeDate,
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
      {children}
    </CalendarContext.Provider>
  );
};

export const useCalendar = () => useContext(CalendarContext);
