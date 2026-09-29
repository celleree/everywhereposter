import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';

const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/frontend/components/layout/loading', () => ({
  __esModule: true,
  default: () => <span>Loading notifications</span>,
}));

const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
const renderBell = () =>
  render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        shouldRetryOnError: false,
      }}
    >
      <NotificationComponent />
    </SWRConfig>
  );

beforeEach(() => {
  mockFetch.mockReset();
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
});

it('shows read and unread items, then refreshes the authoritative badge count', async () => {
  let countCalls = 0;
  mockFetch.mockImplementation(async (path: string) => {
    if (path === '/notifications')
      return response({ total: countCalls++ ? 0 : 2 });
    return response({
      lastReadNotifications: '2026-09-20T00:00:00.000Z',
      notifications: [
        { content: 'Read item', createdAt: '2026-09-19T00:00:00.000Z' },
        { content: 'New item', createdAt: '2026-09-21T00:00:00.000Z' },
      ],
    });
  });
  renderBell();
  const bell = await screen.findByRole('button', {
    name: 'Notifications (2 unread)',
  });
  fireEvent.click(bell);
  expect(bell.getAttribute('aria-expanded')).toBe('true');
  expect(await screen.findByText('Read item')).toBeTruthy();
  expect(screen.getByText('New item')).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy()
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(bell);
});

it('keeps unread state on HTTP failure and retries without showing a false empty state', async () => {
  let listCalls = 0;
  mockFetch.mockImplementation(async (path: string) => {
    if (path === '/notifications') return response({ total: 3 });
    return ++listCalls === 1
      ? response({}, false)
      : response({ lastReadNotifications: '2026-09-20', notifications: [] });
  });
  renderBell();
  const bell = await screen.findByRole('button', {
    name: 'Notifications (3 unread)',
  });
  fireEvent.click(bell);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('No notifications')).toBeNull();
  expect(bell.getAttribute('aria-label')).toBe('Notifications (3 unread)');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No notifications')).toBeTruthy();
  expect(listCalls).toBe(2);
});

it('shows loading while the notification request is pending', async () => {
  mockFetch.mockImplementation((path: string) =>
    path === '/notifications'
      ? Promise.resolve(response({ total: 0 }))
      : new Promise(() => {})
  );
  renderBell();
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
  expect(await screen.findByRole('status')).toBeTruthy();
});
