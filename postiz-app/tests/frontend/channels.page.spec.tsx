import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChannelsComponent } from '../../apps/frontend/src/components/channels/channels.component';

const mockMutate = jest.fn();
const mockFetch = jest.fn();
let mockChannels: any[] = [];
let mockError: Error | undefined;
jest.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => ({ data: mockChannels, isLoading: false, error: mockError, mutate: mockMutate }),
}));
jest.mock('@gitroom/frontend/components/launches/calendar.context', () => ({
  CalendarContext: require('react').createContext({ integrations: [] }),
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => ({ totalChannels: 2 }) }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  AddProviderButton: () => <button>Add Channel</button>,
}));
jest.mock('@gitroom/frontend/components/launches/menu/menu', () => ({
  Menu: ({ id, canDisable, canEnable }: any) => <div data-testid={id}>{canDisable ? 'Can disable' : canEnable ? 'Can enable' : 'At limit'}</div>,
}));
beforeEach(() => { mockChannels = []; mockError = undefined; mockFetch.mockReset(); mockMutate.mockClear(); });

it('shows an empty state and a way to connect the first account', () => {
  render(<ChannelsComponent />);
  expect(screen.getByText(/No channels connected/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add Channel' })).toBeTruthy();
});
it('lists all account states and retains enable/disable management', async () => {
  mockChannels = [
    { id: 'live', name: 'Live', identifier: 'facebook', internalId: 'provider-live' },
    { id: 'off', name: 'Off', identifier: 'x', internalId: 'provider-off', disabled: true },
    { id: 'stale', name: 'Stale', identifier: 'instagram', internalId: 'provider-stale', refreshNeeded: true },
    { id: 'setup', name: 'Setup', identifier: 'youtube', internalId: 'provider-setup', inBetweenSteps: true },
  ];
  mockFetch.mockResolvedValue({ ok: false });
  render(<ChannelsComponent />);
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  expect(screen.getByText('Reconnect required')).toBeTruthy();
  expect(screen.getByText('Setup incomplete')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Finish setup' })).toBeTruthy();
  expect(screen.getByTestId('off').textContent).toBe('At limit');
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Reconnect could not be started');
  expect(mockFetch).toHaveBeenCalledWith('/integrations/social/instagram?refresh=provider-stale', { method: 'GET' });
});
it('offers retry instead of an empty success state on loading failure', () => {
  mockError = new Error('offline');
  render(<ChannelsComponent />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mockMutate).toHaveBeenCalled();
  expect(screen.queryByText(/No channels connected/)).toBeNull();
});

it('keeps API-key accounts on their existing credential-update menu instead of OAuth reconnect', () => {
  mockChannels = [{ id: 'api', name: 'API account', identifier: 'devto', internalId: 'provider-api',
    refreshNeeded: true, isCustomFields: true }];
  render(<ChannelsComponent />);
  expect(screen.getByText('Update credentials in the channel menu')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  expect(screen.getByTestId('api')).toBeTruthy();
  expect(mockFetch).not.toHaveBeenCalled();
});
