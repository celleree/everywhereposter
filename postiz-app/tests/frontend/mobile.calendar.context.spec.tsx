import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { SWRConfig } from 'swr';
import {
  CalendarWeekProvider,
  useCalendar,
} from '@gitroom/frontend/components/launches/calendar.context';
import {
  minifyPosts,
  minifyPostsList,
} from '@gitroom/helpers/utils/posts.list.minify';

const mockFetch = jest.fn();
const mockSetCookie = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('react-use-cookie', () => ({
  __esModule: true,
  default: () => ['month', mockSetCookie],
}));
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => {
  const dayjs = require('dayjs');
  dayjs.extend(require('dayjs/plugin/utc'));
  dayjs.extend(require('dayjs/plugin/timezone'));
  return {
    newDayjs: (value?: string) => dayjs(value || '2026-09-28T12:00:00.000Z'),
  };
});
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const post = (
  id: string,
  state = 'QUEUE',
  extra: Record<string, any> = {}
) => ({
  id,
  state,
  publishDate: '2026-09-28T18:00:00.000Z',
  content: id,
  group: `group-${id}`,
  intervalInDays: null,
  tags: [],
  integration: {
    id: 'account',
    name: 'Account',
    providerIdentifier: 'x',
    picture: '',
  },
  ...extra,
});

let mobile = true;
let viewportChanged: (() => void) | undefined;
const resize = async (value: boolean) => {
  mobile = value;
  await act(async () => {
    viewportChanged?.();
  });
};

const Probe = () => {
  const calendar = useCalendar();
  return (
    <div>
      <span data-testid="view">
        {calendar.isMobile === null
          ? 'pending'
          : calendar.isMobile
          ? calendar.mobileTab
          : calendar.display}
      </span>
      <span data-testid="mobile-posts">
        {calendar.mobilePosts.map((item) => item.id).join(',')}
      </span>
      <span data-testid="error">{calendar.mobileError?.message || ''}</span>
      <span data-testid="page">{calendar.mobilePage}</span>
      <span data-testid="month">{calendar.mobileMonth}</span>
      <button onClick={() => calendar.setMobileTab('all')}>All posts</button>
      <button onClick={() => calendar.setMobileTab('scheduled')}>
        Scheduled
      </button>
      <button onClick={() => calendar.setMobileCustomer('customer-2')}>
        Customer
      </button>
      <button onClick={() => calendar.setMobilePage(1)}>Page two</button>
      <button onClick={() => calendar.moveMobileMonth(-1)}>
        Previous month
      </button>
      <button onClick={calendar.reloadCalendarView}>Refresh</button>
      <button onClick={calendar.retryMobile}>Retry</button>
    </div>
  );
};

const mount = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CalendarWeekProvider integrations={[]}>
        <Probe />
      </CalendarWeekProvider>
    </SWRConfig>
  );

beforeEach(() => {
  mobile = true;
  viewportChanged = undefined;
  mockFetch.mockReset();
  mockSetCookie.mockReset();
  window.localStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      get matches() {
        return mobile;
      },
      addEventListener: (_event: string, listener: () => void) => {
        viewportChanged = listener;
      },
      removeEventListener: () => {
        viewportChanged = undefined;
      },
    }),
  });
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.startsWith('/posts/list?')
        ? minifyPostsList({
            posts: [post('queued')],
            total: 101,
            page: Number(new URLSearchParams(url.split('?')[1]).get('page')),
            limit: 100,
            hasMore: true,
          })
        : url.startsWith('/posts?')
        ? minifyPosts({
            posts: [
              post('draft', 'DRAFT'),
              post('error', 'ERROR'),
              post('published', 'PUBLISHED'),
              post('imported', 'PUBLISHED', {
                source: 'historical',
                readOnly: true,
              }),
              post('repeat', 'PUBLISHED', {
                intervalInDays: 7,
                actualDate: '2026-01-01T18:00:00.000Z',
              }),
            ],
          })
        : {},
  }));
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

it('uses scheduled-only mobile data without changing desktop preference or URL', async () => {
  window.history.replaceState(
    null,
    '',
    '/launches?display=week&startDate=2026-09-21&endDate=2026-09-27'
  );
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('mobile-posts').textContent).toBe('queued')
  );
  expect(screen.getByTestId('view').textContent).toBe('scheduled');
  expect(
    mockFetch.mock.calls.some(
      ([url]) =>
        url.startsWith('/posts/list?') && url.includes('mode=scheduled-once')
    )
  ).toBe(true);
  expect(mockFetch.mock.calls.some(([url]) => url.startsWith('/posts?'))).toBe(
    false
  );
  expect(mockSetCookie).not.toHaveBeenCalled();
  expect(window.location.search).toContain('display=week');
  await resize(false);
  await waitFor(() =>
    expect(
      mockFetch.mock.calls.some(
        ([url]) => url.startsWith('/posts?') && url.includes('display=week')
      )
    ).toBe(true)
  );
  expect(screen.getByTestId('view').textContent).toBe('week');
  expect(
    mockFetch.mock.calls.filter(
      ([url]) => url.startsWith('/posts/list?') && !url.includes('mode=')
    )
  ).toHaveLength(0);
  await resize(true);
  expect(screen.getByTestId('view').textContent).toBe('scheduled');
  expect(mockSetCookie).not.toHaveBeenCalled();
});

it('keeps mobile All posts month and customer state separate from desktop dates', async () => {
  window.history.replaceState(
    null,
    '',
    '/launches?display=month&startDate=2026-01-01&endDate=2026-01-31'
  );
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('mobile-posts').textContent).toBe('queued')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Page two' }));
  await waitFor(() =>
    expect(
      mockFetch.mock.calls.some(
        ([url]) => url.includes('mode=scheduled-once') && url.includes('page=1')
      )
    ).toBe(true)
  );
  fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
  expect(screen.getByTestId('page').textContent).toBe('0');
  expect(window.location.search).toContain('display=month');
  expect(window.location.search).toContain('startDate=2026-01-01');
  expect(window.location.search).toContain('customer=customer-2');
  fireEvent.click(screen.getByRole('button', { name: 'All posts' }));
  await waitFor(() =>
    expect(screen.getByTestId('mobile-posts').textContent).toContain(
      'draft,error,published,imported,repeat'
    )
  );
  const allRequest = mockFetch.mock.calls.find(
    ([url]) => url.startsWith('/posts?') && !url.includes('display=')
  );
  expect(allRequest?.[0]).toContain('customer=customer-2');
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(window.location.search).toContain('endDate=2026-01-31');
  expect(mockSetCookie).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(
      mockFetch.mock.calls.filter(([url]) => url.startsWith('/posts?')).length
    ).toBeGreaterThan(1)
  );
});

test.each(['day', 'week', 'month'])(
  'restores direct display=%s after a mobile-to-desktop resize',
  async (display) => {
    window.history.replaceState(
      null,
      '',
      `/launches?display=${display}&startDate=2026-09-28&endDate=2026-09-28`
    );
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('view').textContent).toBe('scheduled')
    );
    await resize(false);
    expect(screen.getByTestId('view').textContent).toBe(display);
    expect(mockSetCookie).not.toHaveBeenCalled();
  }
);

it('keeps desktop list requests in the legacy mode', async () => {
  mobile = false;
  window.history.replaceState(null, '', '/launches?display=list');
  mount();
  await waitFor(() =>
    expect(
      mockFetch.mock.calls.some(([url]) => url.startsWith('/posts/list?'))
    ).toBe(true)
  );
  expect(
    mockFetch.mock.calls
      .filter(([url]) => url.startsWith('/posts/list?'))
      .every(([url]) => !url.includes('mode='))
  ).toBe(true);
  expect(screen.getByTestId('view').textContent).toBe('list');
});

it('clamps the scheduled page when refresh removes the last item', async () => {
  window.history.replaceState(null, '', '/launches?display=month');
  let total = 101;
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.startsWith('/posts/list?')
        ? minifyPostsList({
            posts:
              total === 100 && url.includes('page=1') ? [] : [post('queued')],
            total,
            page: Number(new URLSearchParams(url.split('?')[1]).get('page')),
            limit: 100,
            hasMore: total > 100 && url.includes('page=0'),
          })
        : {},
  }));
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('mobile-posts').textContent).toBe('queued')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Page two' }));
  await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('1'));
  total = 100;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('0'));
});

it('respects the existing imported-post visibility preference in All posts', async () => {
  window.localStorage.setItem('calendar-show-imported-posts', 'false');
  window.history.replaceState(null, '', '/launches?display=week');
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'All posts' }));
  await waitFor(() =>
    expect(screen.getByTestId('mobile-posts').textContent).toContain(
      'draft,error,published'
    )
  );
  expect(screen.getByTestId('mobile-posts').textContent).not.toContain(
    'imported'
  );
  act(() => {
    window.localStorage.setItem('calendar-show-imported-posts', 'true');
    window.dispatchEvent(
      new CustomEvent('calendar-show-imported-posts-changed', {
        detail: { showImportedPosts: true },
      })
    );
  });
  expect(screen.getByTestId('mobile-posts').textContent).toContain('imported');
});

it('retries a failed scheduled request without showing it as an empty result', async () => {
  window.history.replaceState(null, '', '/launches?display=month');
  let failing = true;
  mockFetch.mockImplementation(async (url: string) => ({
    ok: !failing || !url.startsWith('/posts/list?'),
    json: async () =>
      url.startsWith('/posts/list?')
        ? minifyPostsList({
            posts: [post('queued')],
            total: 1,
            page: 0,
            limit: 100,
            hasMore: false,
          })
        : {},
  }));
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('error').textContent).toBe(
      'Unable to load scheduled posts'
    )
  );
  expect(screen.getByTestId('mobile-posts').textContent).toBe('');
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByTestId('mobile-posts').textContent).toBe('queued')
  );
  expect(screen.getByTestId('error').textContent).toBe('');
});
