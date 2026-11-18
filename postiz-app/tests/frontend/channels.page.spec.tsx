import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { ChannelsComponent } from '../../apps/frontend/src/components/channels/channels.component';
import { ContinueProvider } from '../../apps/frontend/src/components/layout/continue.provider';

const mockFetch = jest.fn();
const mockUser = { totalChannels: 2, unlimitedChannels: false };
const mockOpenModal = jest.fn();
const mockCloseModal = jest.fn();
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: mockOpenModal, closeCurrent: mockCloseModal }),
}));
jest.mock('@gitroom/frontend/components/launches/calendar.context', () => ({
  CalendarContext: require('react').createContext({ integrations: [] }),
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => mockUser }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@gitroom/frontend/components/new-launch/providers/continue-provider/list', () => ({
  continueProviderList: {},
}));
jest.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  AddProviderButton: () => <button>Add Channel</button>,
  UrlModal: () => null,
}));
jest.mock('@gitroom/frontend/components/launches/menu/menu', () => ({
  Menu: ({ id, canDisable, canEnable }: any) => <div data-testid={id}>{canDisable ? 'Can disable' : canEnable ? 'Can enable' : 'At limit'}</div>,
}));
function channelList(integrations: unknown[]) {
  return { ok: true, json: async () => ({ integrations }) };
}

function renderChannels() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <ContinueProvider />
      <ChannelsComponent />
    </SWRConfig>
  );
}

beforeEach(() => {
  mockUser.totalChannels = 2;
  mockUser.unlimitedChannels = false;
  mockFetch.mockReset();
  mockOpenModal.mockClear();
  mockCloseModal.mockClear();
});

it('shows an empty state and a way to connect the first account', async () => {
  mockFetch.mockResolvedValueOnce(channelList([]));
  renderChannels();
  expect(await screen.findByText(/No channels connected/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add Channel' })).toBeTruthy();
});
it('lists all account states and retains enable/disable management', async () => {
  mockFetch.mockResolvedValueOnce(channelList([
    { id: 'live', name: 'Live', identifier: 'facebook', internalId: 'provider-live' },
    { id: 'off', name: 'Off', identifier: 'x', internalId: 'provider-off', disabled: true },
    { id: 'stale', name: 'Stale', identifier: 'instagram', internalId: 'provider-stale', refreshNeeded: true },
    { id: 'setup', name: 'Setup', identifier: 'youtube', internalId: 'provider-setup', inBetweenSteps: true },
  ]));
  mockFetch.mockResolvedValue({ ok: false });
  renderChannels();
  expect(await screen.findAllByRole('listitem')).toHaveLength(4);
  expect(screen.getByText('Reconnect required')).toBeTruthy();
  expect(screen.getByText('Setup incomplete')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Finish setup' })).toBeTruthy();
  expect(screen.getByTestId('off').textContent).toBe('At limit');
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Reconnect could not be started');
  expect(mockFetch).toHaveBeenCalledWith('/integrations/social/instagram?refresh=provider-stale', { method: 'GET' });
});
it.each([
  { totalChannels: 0, unlimitedChannels: true, action: 'Can enable' },
  { totalChannels: 0, unlimitedChannels: false, action: 'At limit' },
  { totalChannels: 1, unlimitedChannels: false, action: 'Can enable' },
])('uses the channel allowance for a disabled account ($totalChannels, unlimited=$unlimitedChannels)', async ({ totalChannels, unlimitedChannels, action }) => {
  Object.assign(mockUser, { totalChannels, unlimitedChannels });
  mockFetch.mockResolvedValueOnce(channelList([{ id: 'off', name: 'Off', disabled: true }]));
  renderChannels();
  expect((await screen.findByTestId('off')).textContent).toBe(action);
});

it('offers Retry on an HTTP 500 and shows the recovered channel list', async () => {
  mockFetch
    .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'Server error' }) })
    .mockResolvedValueOnce(channelList([{ id: 'live', name: 'Recovered channel' }]));
  renderChannels();
  expect((await screen.findByRole('alert')).textContent).toContain('Channels could not be loaded');
  expect(screen.queryByText(/No channels connected/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: 'Recovered channel' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockFetch.mock.calls).toEqual([['/integrations/list'], ['/integrations/list']]);
});

it('keeps API-key accounts on their existing credential-update menu instead of OAuth reconnect', async () => {
  mockFetch.mockResolvedValueOnce(channelList([{ id: 'api', name: 'API account', identifier: 'devto', internalId: 'provider-api',
    refreshNeeded: true, isCustomFields: true }]));
  renderChannels();
  expect(await screen.findByText('Update credentials in the channel menu')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  expect(screen.getByTestId('api')).toBeTruthy();
  expect(mockFetch.mock.calls).toEqual([['/integrations/list']]);
});

it('asks for the Mastodon instance before reconnecting and includes it in the authorization request', async () => {
  mockFetch.mockResolvedValueOnce(channelList([{ id: 'instance', name: 'My Mastodon', identifier: 'mastodon-custom',
    internalId: 'provider-instance', refreshNeeded: true }]));
  mockFetch.mockResolvedValue({ ok: false });
  renderChannels();
  fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
  expect(mockFetch.mock.calls).toEqual([['/integrations/list']]);
  expect(mockOpenModal).toHaveBeenCalledWith(expect.objectContaining({ title: 'Instance URL' }));
  await act(async () => {
    mockOpenModal.mock.calls.at(-1)[0].children.props.gotoUrl('https://social.example.test');
  });
  expect(mockFetch).toHaveBeenCalledWith(
    '/integrations/social/mastodon-custom?refresh=provider-instance&externalUrl=https%3A%2F%2Fsocial.example.test',
    { method: 'GET' }
  );
  expect(mockCloseModal).toHaveBeenCalled();
  expect((await screen.findByRole('alert')).textContent).toContain('Reconnect could not be started');
});
