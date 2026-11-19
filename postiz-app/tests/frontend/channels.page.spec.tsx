import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ModalManagerInner } from '../../apps/frontend/src/components/layout/new-modal';
import { SWRConfig } from 'swr';
import { ChannelsComponent } from '../../apps/frontend/src/components/channels/channels.component';
import { ContinueProvider } from '../../apps/frontend/src/components/layout/continue.provider';

jest.mock('react-hotkeys-hook', () => ({ useHotkeys: jest.fn() }));

const mockFetch = jest.fn();
const mockUser = { totalChannels: 2, unlimitedChannels: false };
function mockNavigate(url: string, replace = false) {
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
const mockRouter = { push: (url: string) => mockNavigate(url), replace: (url: string) => mockNavigate(url, true) };
jest.mock('@gitroom/frontend/components/launches/calendar.context', () => ({
  CalendarContext: require('react').createContext({ integrations: [] }),
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => mockUser }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(require('react').useSyncExternalStore(
    (notify: () => void) => {
      window.addEventListener('popstate', notify);
      return () => window.removeEventListener('popstate', notify);
    }, () => window.location.search,
  )),
}));
jest.mock('@gitroom/frontend/components/new-launch/providers/continue-provider/list', () => ({
  continueProviderList: {
    facebook: jest.requireActual('@gitroom/frontend/components/new-launch/providers/continue-provider/facebook/facebook.continue').FacebookContinue,
  },
}));
jest.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  AddProviderButton: () => <button>Add Channel</button>,
  UrlModal: ({ gotoUrl }: { gotoUrl: (url: string) => void }) =>
    <button onClick={() => gotoUrl('https://social.example.test')}>Use instance</button>,
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
      <ModalManagerInner />
      <ContinueProvider />
      <ChannelsComponent />
    </SWRConfig>
  );
}

beforeEach(() => {
  mockUser.totalChannels = 2;
  mockUser.unlimitedChannels = false;
  mockFetch.mockReset();
  window.history.replaceState(null, '', '/channels');
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
  const dialog = await screen.findByRole('dialog', { name: 'Instance URL' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Use instance' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Reconnect could not be started');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockFetch).toHaveBeenCalledWith(
    '/integrations/social/mastodon-custom?refresh=provider-instance&externalUrl=https%3A%2F%2Fsocial.example.test',
    { method: 'GET' }
  );
});

function mockFacebookSetup(saving?: Promise<unknown>) {
  const channels = ['first', 'second'].map(id => ({ id, name: id, identifier: 'facebook', inBetweenSteps: true }));
  mockFetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/integrations/list') return channelList(channels);
    if (path === '/integrations/provider/first/connect') return saving;
    if (path !== '/integrations/function') throw new Error(`Unexpected request ${path}`);
    const { id } = JSON.parse(options?.body as string);
    return { status: 200, json: async () => [{ id: `page-${id}`, name: `Page for ${id}`, picture: { data: { url: '/picture.jpg' } } }] };
  });
}

it('reopens dismissed setup and follows the selected account without keeping an obsolete dialog', async () => {
  mockFacebookSetup();
  renderChannels();
  const [first, second] = await screen.findAllByRole('button', { name: 'Finish setup' });
  fireEvent.click(first);
  expect(await screen.findByText('Page for first')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(window.location.search).toBe('');
  fireEvent.click(first);
  expect(await screen.findByText('Page for first')).toBeTruthy();
  act(() => mockNavigate('/channels?tab=accounts&added=facebook&continue=second#selected'));
  expect(await screen.findByText('Page for second')).toBeTruthy();
  expect(screen.queryByText('Page for first')).toBeNull();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(window.location.search + window.location.hash).toBe('?tab=accounts#selected');
  fireEvent.click(second);
  expect(await screen.findByText('Page for second')).toBeTruthy();
  act(() => mockNavigate('/channels'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps a reopened dialog active when an earlier save for the same account finishes', async () => {
  let finishSave!: () => void;
  mockFacebookSetup(new Promise<void>(resolve => { finishSave = resolve; }));
  renderChannels();
  const [first] = await screen.findAllByRole('button', { name: 'Finish setup' });
  fireEvent.click(first);
  fireEvent.click(await screen.findByText('Page for first'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockFetch).toHaveBeenCalledWith('/integrations/provider/first/connect', expect.objectContaining({ method: 'POST' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  fireEvent.click(first);
  expect(await screen.findByText('Page for first')).toBeTruthy();
  await act(async () => finishSave());
  expect(screen.getByRole('dialog', { name: 'Configure Channel' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
});
