import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import dayjs from 'dayjs';
import {
  CalendarWeekProvider,
  useCalendar,
} from '@gitroom/frontend/components/launches/calendar.context';
import {
  minifyPosts,
  minifyPostsList,
} from '@gitroom/helpers/utils/posts.list.minify';

const mockFetch = jest.fn();
const mockShow = jest.fn();
let mockUser: any = { id: 'user', orgId: 'org' };
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => mockUser,
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('react-use-cookie', () => ({
  __esModule: true,
  default: () => ['week', jest.fn()],
}));
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => {
  const dayjs = require('dayjs');
  dayjs.extend(require('dayjs/plugin/utc'));
  return {
    newDayjs: (value?: string) => dayjs(value || '2026-11-03T12:00:00Z'),
  };
});

const oldDate = '2026-11-03T18:00:00';
const newDate = '2026-11-04T18:00:00';
const post = (id = 'a', extra = {}) => ({
  id,
  state: 'QUEUE',
  publishDate: oldDate,
  content: id,
  group: `group-${id}`,
  intervalInDays: null,
  tags: [],
  integration: { id: 'account', name: 'Account', providerIdentifier: 'x' },
  ...extra,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let mobile = false;
let viewportChanged: (() => void) | undefined;
let source: any[];
let latest: ReturnType<typeof useCalendar>;
const visible = () =>
  latest.isMobile
    ? latest.mobilePosts
    : latest.display === 'list'
    ? latest.listPosts
    : latest.posts;
const Probe = () => {
  latest = useCalendar();
  return (
    <div data-testid="posts">
      {visible()
        .map((p) => `${p.id}:${p.publishDate}:${p.content}`)
        .join('|')}
    </div>
  );
};
const response = (url: string, rows = source) => ({
  ok: true,
  json: async () =>
    url.startsWith('/posts/list?')
      ? minifyPostsList({
          posts: rows,
          total: rows.length,
          page: 0,
          limit: 100,
          hasMore: false,
        })
      : url.startsWith('/posts?')
      ? minifyPosts({ posts: rows })
      : url === '/sets'
      ? []
      : {},
});
const mount = () =>
  render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        shouldRetryOnError: false,
      }}
    >
      <CalendarWeekProvider integrations={[]}>
        <Probe />
      </CalendarWeekProvider>
    </SWRConfig>
  );
const ready = () =>
  waitFor(() => expect(visible()).toHaveLength(source.length));
const save = (
  id = 'a',
  confirm?: () => Promise<'schedule' | 'update' | 'cancel'>
) =>
  latest.reschedulePost(
    visible().find((p) => p.id === id)!,
    dayjs.utc(newDate),
    confirm
  );
const dateOf = (id = 'a') =>
  dayjs.utc(visible().find((p) => p.id === id)?.publishDate).format('YYYY-MM-DDTHH:mm:ss');
const writes = () =>
  mockFetch.mock.calls.filter(([, options]) => options?.method === 'PUT');

beforeEach(() => {
  source = [post(), post('b')];
  mockUser = { id: 'user', orgId: 'org' };
  mockFetch.mockReset();
  mockShow.mockReset();
  mobile = false;
  window.localStorage.clear();
  window.history.replaceState(null, '', '/launches?display=week');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      get matches() {
        return mobile;
      },
      addEventListener: (_: string, callback: () => void) => {
        viewportChanged = callback;
      },
      removeEventListener: () => {},
    }),
  });
  mockFetch.mockImplementation(async (url: string) => response(url));
});
afterEach(() => window.history.replaceState(null, '', '/'));

it.each([400, 403, 500])(
  'rolls back only the rejected post after delayed HTTP %s',
  async (status) => {
    const rejected = deferred<any>();
    const accepted = deferred<any>();
    mockFetch.mockImplementation((url: string, options: any) =>
      options?.method === 'PUT'
        ? url.includes('/a/')
          ? rejected.promise
          : accepted.promise
        : Promise.resolve(response(url))
    );
    mount();
    await ready();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = save();
      second = save('b');
    });
    expect(dateOf()).toBe(newDate);
    expect(dateOf('b')).toBe(newDate);
    // An unrelated refresh must preserve both pending dates and fresh content.
    source = [post('a', { content: 'fresh' }), post('b')];
    act(() => latest.reloadCalendarView());
    await waitFor(() =>
      expect(screen.getByTestId('posts').textContent).toContain('fresh')
    );
    expect(dateOf()).toBe(newDate);
    expect(dateOf('b')).toBe(newDate);
    await act(async () => {
      rejected.resolve({ ok: false, status });
      await first;
    });
    expect(dayjs.utc(dateOf()).format()).toBe(dayjs.utc(oldDate).format());
    expect(dateOf('b')).toBe(newDate);
    source = [
      post('a', { content: 'fresh' }),
      post('b', { publishDate: newDate }),
    ];
    await act(async () => {
      accepted.resolve({ ok: true });
      await second;
    });
    expect(dayjs.utc(dateOf('b')).format()).toBe(dayjs.utc(newDate).format());
    expect(mockShow.mock.calls[0][0]).toContain(
      'previous date has been restored'
    );
  }
);

it('locks same-tick drops throughout confirmation, save, and reconciliation', async () => {
  const dialog = deferred<'schedule'>();
  const put = deferred<any>();
  const refresh = deferred<any>();
  const confirm = jest.fn(() => dialog.promise);
  mockFetch.mockImplementation((url: string, options: any) =>
    options?.method === 'PUT' ? put.promise : Promise.resolve(response(url))
  );
  mount();
  await ready();
  let pending!: Promise<void>;
  act(() => {
    pending = save('a', confirm);
    void save('a', confirm);
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(writes()).toHaveLength(0);
  await act(async () => {
    dialog.resolve('schedule');
    await Promise.resolve();
  });
  expect(writes()).toHaveLength(1);
  act(() => {
    void save();
    void save();
  });
  expect(writes()).toHaveLength(1);
  mockFetch.mockImplementation((url: string, options: any) =>
    options?.method === 'PUT'
      ? put.promise
      : url.startsWith('/posts?')
      ? refresh.promise
      : Promise.resolve(response(url))
  );
  await act(async () => {
    put.resolve({ ok: true });
    await Promise.resolve();
  });
  act(() => {
    void save();
  });
  expect(writes()).toHaveLength(1);
  await act(async () => {
    refresh.resolve(
      response('/posts?', [post('a', { publishDate: newDate }), post('b')])
    );
    await pending;
  });
  expect(latest.isRescheduling('a')).toBe(false);
});

it.each(['day', 'week', 'month', 'list', 'scheduled', 'all'])(
  'preserves the pending date through %s view reads',
  async (view) => {
    mobile = view === 'scheduled' || view === 'all';
    window.history.replaceState(
      null,
      '',
      `/launches?display=${mobile ? 'month' : view}`
    );
    const put = deferred<any>();
    mockFetch.mockImplementation((url: string, options: any) =>
      options?.method === 'PUT' ? put.promise : Promise.resolve(response(url))
    );
    mount();
    await ready();
    if (view === 'all') {
      act(() => latest.setMobileTab('all'));
      await ready();
    }
    let pending!: Promise<void>;
    act(() => {
      pending = save();
    });
    act(() => latest.reloadCalendarView());
    await waitFor(() => expect(dateOf()).toBe(newDate));
    expect(latest.isRescheduling('a')).toBe(true);
    source = [post('a', { publishDate: newDate }), post('b')];
    await act(async () => {
      put.resolve({ ok: true });
      await pending;
    });
    expect(dayjs.utc(dateOf()).format()).toBe(dayjs.utc(newDate).format());
  }
);

it('keeps a saved date when refresh fails and accepts a later authoritative read', async () => {
  const put = deferred<any>();
  mount();
  await ready();
  mockFetch.mockImplementation((url: string, options: any) =>
    options?.method === 'PUT'
      ? put.promise
      : url.startsWith('/posts')
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(response(url))
  );
  let pending!: Promise<void>;
  act(() => {
    pending = save();
  });
  await act(async () => {
    put.resolve({ ok: true });
    await pending;
  });
  expect(dateOf()).toBe(newDate);
  expect(mockShow).toHaveBeenLastCalledWith(
    expect.stringContaining('Schedule saved, but'),
    'warning'
  );
  source = [post('a', { publishDate: '2026-11-05T18:00:00' }), post('b')];
  mockFetch.mockImplementation(async (url: string) => response(url));
  act(() => latest.reloadCalendarView());
  await waitFor(() =>
    expect(dayjs.utc(dateOf()).format()).toBe('2026-11-05T18:00:00Z')
  );
});

it('keeps an unknown save locked until a successful authoritative refresh', async () => {
  const put = deferred<any>();
  mount();
  await ready();
  mockFetch.mockImplementation((url: string, options: any) =>
    options?.method === 'PUT'
      ? put.promise
      : url.startsWith('/posts')
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(response(url))
  );
  let pending!: Promise<void>;
  act(() => {
    pending = save();
  });
  await act(async () => {
    put.reject(new Error('connection lost'));
    await pending;
  });
  expect(dateOf()).toBe(newDate);
  expect(latest.isRescheduling('a')).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('unconfirmed');
  expect(mockShow).toHaveBeenLastCalledWith(
    expect.stringContaining('could not be confirmed'),
    'warning'
  );
  act(() => {
    void save();
  });
  expect(writes()).toHaveLength(1);
  // The server may have accepted the write; use its result rather than a rollback.
  source = [post('a', { publishDate: newDate }), post('b')];
  mockFetch.mockImplementation(async (url: string) => response(url));
  act(() => latest.reloadCalendarView());
  await waitFor(() => expect(latest.isRescheduling('a')).toBe(false));
  expect(dayjs.utc(dateOf()).format()).toBe(dayjs.utc(newDate).format());
});

it('uses authoritative state after a network rejection without claiming rollback', async () => {
  const put = deferred<any>();
  mockFetch.mockImplementation((url: string, options: any) =>
    options?.method === 'PUT' ? put.promise : Promise.resolve(response(url))
  );
  mount();
  await ready();
  let pending!: Promise<void>;
  act(() => {
    pending = save();
  });
  await act(async () => {
    put.reject(new Error('lost response'));
    await pending;
  });
  expect(dayjs.utc(dateOf()).format()).toBe(dayjs.utc(oldDate).format());
  expect(mockShow).toHaveBeenLastCalledWith(
    expect.stringContaining('calendar has been refreshed'),
    'warning'
  );
  expect(
    mockShow.mock.calls.every(([text]) => !text.includes('restored'))
  ).toBe(true);
});

it('does not let an older read replace a confirmed write', async () => {
  const stale = deferred<any>();
  const put = deferred<any>();
  mount();
  await ready();
  mockFetch.mockImplementationOnce(() => stale.promise);
  act(() => latest.reloadCalendarView());
  mockFetch.mockImplementation((url: string, options: any) =>
    options?.method === 'PUT' ? put.promise : Promise.resolve(response(url))
  );
  let pending!: Promise<void>;
  act(() => {
    pending = save();
  });
  source = [post('a', { publishDate: newDate }), post('b')];
  await act(async () => {
    put.resolve({ ok: true });
    await pending;
  });
  await act(async () => {
    stale.resolve(response('/posts?', [post(), post('b')]));
  });
  expect(dayjs.utc(dateOf()).format()).toBe(dayjs.utc(newDate).format());
});

it('carries an optimistic date into another calendar view and mobile', async () => {
  const put = deferred<any>();
  mockFetch.mockImplementation((url: string, options: any) =>
    options?.method === 'PUT' ? put.promise : Promise.resolve(response(url))
  );
  mount();
  await ready();
  let pending!: Promise<void>;
  act(() => {
    pending = save();
  });
  act(() =>
    latest.setFilters({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      display: 'list',
      customer: null,
    })
  );
  await ready();
  expect(dateOf()).toBe(newDate);
  await act(async () => {
    mobile = true;
    viewportChanged?.();
  });
  await ready();
  expect(dateOf()).toBe(newDate);
  await act(async () => {
    put.resolve({ ok: false, status: 400 });
    await pending;
  });
  expect(mockShow).not.toHaveBeenCalled();
});

it.each(['unmount', 'organization', 'navigation'])(
  'suppresses late notifications after %s',
  async (change) => {
    const put = deferred<any>();
    mockFetch.mockImplementation((url: string, options: any) =>
      options?.method === 'PUT' ? put.promise : Promise.resolve(response(url))
    );
    const rendered = mount();
    await ready();
    let pending!: Promise<void>;
    act(() => {
      pending = save();
    });
    if (change === 'unmount') rendered.unmount();
    if (change === 'organization') {
      mockUser = { id: 'user', orgId: 'other-org' };
      source = [post('new-org')];
      rendered.rerender(
        <SWRConfig
          value={{ provider: () => new Map(), shouldRetryOnError: false }}
        >
          <CalendarWeekProvider integrations={[]}>
            <Probe />
          </CalendarWeekProvider>
        </SWRConfig>
      );
      await ready();
    }
    if (change === 'navigation')
      window.history.replaceState(null, '', '/settings');
    await act(async () => {
      put.resolve({ ok: true });
      await pending;
    });
    expect(mockShow).not.toHaveBeenCalled();
    if (change === 'organization')
      expect(visible().map((p) => p.id)).toEqual(['new-org']);
  }
);

it('cancels stale confirmations and refuses historical records', async () => {
  const dialog = deferred<'schedule'>();
  source = [post(), post('history', { source: 'historical', readOnly: true })];
  mount();
  await ready();
  await act(async () => {
    await save('history');
  });
  let pending!: Promise<void>;
  act(() => {
    pending = save('a', () => dialog.promise);
  });
  window.history.replaceState(null, '', '/settings');
  await act(async () => {
    dialog.resolve('schedule');
    await pending;
  });
  expect(writes()).toHaveLength(0);
});

it('preserves recurrence handling and sends the selected published-post action', async () => {
  source = [post('repeat', { intervalInDays: 7, state: 'PUBLISHED' })];
  const put = deferred<any>();
  mockFetch.mockImplementation((url: string, options: any) =>
    options?.method === 'PUT' ? put.promise : Promise.resolve(response(url))
  );
  mount();
  await ready();
  let pending!: Promise<void>;
  await act(async () => {
    pending = save('repeat', async () => 'update');
    await Promise.resolve();
  });
  expect(dateOf('repeat')).toBe(oldDate);
  expect(JSON.parse(writes()[0][1].body)).toEqual({ date: newDate, action: 'update' });
  await act(async () => { put.resolve({ ok: true }); await pending; });
  expect(latest.isRescheduling('repeat')).toBe(false);
});

it('releases a cancelled confirmation without sending a write', async () => {
  mount();
  await ready();
  await act(async () => { await save('a', async () => 'cancel'); });
  expect(writes()).toHaveLength(0);
  expect(dateOf()).toBe(oldDate);
  expect(latest.isRescheduling('a')).toBe(false);
});
