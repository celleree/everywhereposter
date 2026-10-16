import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { AiWalletComponent, walletDollars } from '../../apps/frontend/src/components/billing/ai-wallet.component';

let mockUser = { id: 'user', orgId: 'org-a' };
const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => mockUser }));
const snapshot = (organizationId = 'org-a') => ({ organizationId, currency: 'usd', status: 'ACTIVE',
  balanceNanos: '1230000000', heldNanos: '5000000', availableNanos: '1225000000',
  operations: [{ id: 'pending', provider: 'openai', model: 'fixture', state: 'UNKNOWN',
    ceilingNanos: '5000000', chargedNanos: null, createdAt: '2035-01-01T00:00:00Z' },
    { id: 'settled', provider: 'openai', model: 'fixture', state: 'SETTLED',
      ceilingNanos: '4000000', chargedNanos: '1', createdAt: '2035-01-01T00:00:00Z' }],
  entries: [{ id: 'usage', kind: 'USAGE', amountNanos: '1', createdAt: '2035-01-01T00:00:00Z' }] });
const response = (value: any, ok = true) => ({ ok, json: async () => value });
const mount = () => {
  const cache = new Map();
  return render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><AiWalletComponent /></SWRConfig>);
};
beforeEach(() => { mockUser = { id: 'user', orgId: 'org-a' }; mockFetch.mockReset(); });
afterEach(cleanup);
it('formats exact nano-USD amounts without rounding small charges to zero', () => {
  expect(walletDollars('1')).toBe('$0.000000001'); expect(walletDollars('10000000')).toBe('$0.01');
  expect(walletDollars('9007199254740993000')).toBe('$9007199254.740993');
  expect(walletDollars('0')).toBe('$0.00'); expect(walletDollars('-1')).toBe('Unavailable');
});
it('distinguishes reserved maximum from settled cost and makes only read requests', async () => {
  mockFetch.mockResolvedValue(response(snapshot())); mount();
  expect(await screen.findByText('Pending reconciliation · Reserved maximum $0.005')).toBeTruthy();
  expect(screen.getByText('Settled · Charged $0.000000001')).toBeTruthy();
  expect(screen.getByText('$1.225')).toBeTruthy();
  for (const args of mockFetch.mock.calls) expect(args).toEqual(['/billing/ai-wallet']);
});
it('handles an unavailable wallet and retries a read to show empty history', async () => {
  mockFetch.mockResolvedValueOnce(response({}, false)).mockResolvedValue(response({ ...snapshot(), operations: [], entries: [] }));
  mount(); expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry balance' }));
  expect(await screen.findByText('No AI operations yet.')).toBeTruthy();
  expect(screen.getByText('No settled transactions yet.')).toBeTruthy();
});
it('rejects a mismatched organization snapshot instead of displaying its costs', async () => {
  mockFetch.mockResolvedValue(response(snapshot('org-b'))); mount();
  expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.queryByText('$1.225')).toBeNull();
});
it('clears previous tenant data while a different organization is loading', async () => {
  const cache = new Map();
  const ui = () => <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><AiWalletComponent /></SWRConfig>;
  mockFetch.mockResolvedValueOnce(response(snapshot())); const view = render(ui());
  expect(await screen.findByText('$1.225')).toBeTruthy();
  let complete!: (value: any) => void; mockFetch.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  mockUser = { id: 'user', orgId: 'org-b' }; view.rerender(ui());
  expect(screen.queryByText('$1.225')).toBeNull();
  await waitFor(() => expect(complete).toBeDefined());
  complete(response({ ...snapshot('org-b'), status: 'REVIEW', operations: [], entries: [] }));
  expect(await screen.findByText('Usage needs reconciliation. Pending amounts remain reserved.')).toBeTruthy();
});
