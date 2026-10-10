import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { RenderAnalytics } from '@gitroom/frontend/components/platform-analytics/render.analytics';

const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_key: string, fallback: string) => fallback }));
jest.mock('@gitroom/frontend/components/layout/loading', () => ({ LoadingComponent: () => <span data-testid="spinner" /> }));
jest.mock('@gitroom/frontend/components/analytics/chart-social', () => ({ ChartSocial: () => null }));
jest.mock('@gitroom/frontend/components/platform-analytics/platform.video.grid', () => ({ PlatformVideoGrid: () => null }));
jest.mock('@gitroom/frontend/components/launches/helpers/integration.return-route', () => ({ storeIntegrationReturnRoute: jest.fn() }));

const channel = { id: 'channel-a', identifier: 'youtube', internalId: 'synthetic', name: 'Synthetic channel' } as any;
const metrics = (label: string) => [{ label, data: [{ total: 12, date: '2035-01-01' }] }];
const response = (data: unknown) => ({ ok: true, json: async () => data });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async (operation: () => void) => act(async () => { operation(); await Promise.resolve(); });
const pending = () => expect(screen.queryByTestId('spinner')).not.toBeNull();
const settled = () => expect(screen.queryByTestId('spinner')).toBeNull();

function mount(date = 7, integration = channel, cache = new Map()) {
  const wrapper = ({ children }: { children: React.ReactNode }) => <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>;
  const view = render(<RenderAnalytics integration={integration} date={date} />, { wrapper });
  return { ...view, change: (nextDate: number, nextChannel = integration) => view.rerender(<RenderAnalytics integration={nextChannel} date={nextDate} />) };
}

beforeEach(() => {
  mockFetch.mockReset();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => jest.useRealTimers());

it('keeps loading until both the response and metrics JSON settle', async () => {
  const request = deferred<any>();
  const body = deferred<any>();
  const json = jest.fn(() => body.promise);
  mockFetch.mockReturnValue(request.promise);
  mount();
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  pending();
  await settle(() => request.resolve({ ok: true, json }));
  expect(json).toHaveBeenCalledTimes(1);
  pending();
  await settle(() => body.resolve(metrics('Current metrics')));
  expect(await screen.findByText('Current metrics')).toBeTruthy();
  settled();
  expect(mockFetch).toHaveBeenCalledWith('/analytics/channel-a?date=7');
});

it('stops loading on rejection without presenting a successful empty response', async () => {
  const request = deferred<any>();
  mockFetch.mockReturnValue(request.promise);
  mount();
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  pending();
  await settle(() => request.reject(new Error('Synthetic metrics failure')));
  await waitFor(settled);
  expect(screen.queryByText('This channel needs to be refreshed to display analytics')).toBeNull();
});

it('shows the existing empty state only after an empty metrics response settles', async () => {
  const request = deferred<any>();
  mockFetch.mockReturnValue(request.promise);
  mount();
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  pending();
  await settle(() => request.resolve(response([])));
  expect(await screen.findByText('This channel needs to be refreshed to display analytics')).toBeTruthy();
  settled();
});

it('keeps the new range loading when an older response settles first', async () => {
  const older = deferred<any>();
  const newer = deferred<any>();
  mockFetch.mockImplementation((url: string) => url.endsWith('date=7') ? older.promise : newer.promise);
  const view = mount();
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  view.change(30);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  await settle(() => older.resolve(response(metrics('Old range'))));
  pending();
  expect(screen.queryByText('Old range')).toBeNull();
  await settle(() => newer.resolve(response(metrics('New range'))));
  expect(await screen.findByText('New range')).toBeTruthy();
  settled();
});

it('does not replace the current range when an older response finishes last', async () => {
  const older = deferred<any>();
  const newer = deferred<any>();
  mockFetch.mockImplementation((url: string) => url.endsWith('date=7') ? older.promise : newer.promise);
  const view = mount();
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  view.change(30);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  await settle(() => newer.resolve(response(metrics('New range'))));
  expect(await screen.findByText('New range')).toBeTruthy();
  await settle(() => older.resolve(response(metrics('Old range'))));
  expect(screen.getByText('New range')).toBeTruthy();
  expect(screen.queryByText('Old range')).toBeNull();
  settled();
});

it('isolates an unmounted channel request from the newly selected channel', async () => {
  const cache = new Map();
  const older = deferred<any>();
  const newer = deferred<any>();
  mockFetch.mockImplementation((url: string) => url.includes('channel-a') ? older.promise : newer.promise);
  const first = mount(7, channel, cache);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  first.unmount();
  mount(7, { ...channel, id: 'channel-b' }, cache);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  await settle(() => older.resolve(response(metrics('Old channel'))));
  pending();
  await settle(() => newer.resolve(response(metrics('New channel'))));
  expect(await screen.findByText('New channel')).toBeTruthy();
  expect(screen.queryByText('Old channel')).toBeNull();
});

it('preserves the selected cache key and waits for mount revalidation', async () => {
  const cache = new Map([['/analytics-channel-a-7', { data: metrics('Cached metrics') }]]);
  const request = deferred<any>();
  mockFetch.mockReturnValue(request.promise);
  mount(7, channel, cache);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  pending();
  await settle(() => request.resolve(response(metrics('Fresh metrics'))));
  expect(await screen.findByText('Fresh metrics')).toBeTruthy();
  expect(cache.get('/analytics-channel-a-7')?.data).toEqual(metrics('Fresh metrics'));
});

it('keeps an in-flight manual refresh attached to its original range cache', async () => {
  jest.useFakeTimers();
  const cache = new Map();
  const refresh = deferred<any>();
  mockFetch.mockImplementation((url: string) => url.includes('refresh=true') ? refresh.promise : Promise.resolve(response(metrics(url.endsWith('date=7') ? 'Initial range' : 'Current range'))));
  const view = mount(7, { ...channel, identifier: 'instagram' }, cache);
  expect(await screen.findByText('Initial range')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(15 * 60 * 1000));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/analytics/channel-a?date=7&refresh=true'));
  pending();
  view.change(30);
  expect(await screen.findByText('Current range')).toBeTruthy();
  await settle(() => refresh.resolve(response(metrics('Stale manual result'))));
  expect(screen.getByText('Current range')).toBeTruthy();
  expect(screen.queryByText('Stale manual result')).toBeNull();
  expect(cache.get('/analytics-channel-a-7')?.data).toEqual(metrics('Stale manual result'));
  settled();
});
