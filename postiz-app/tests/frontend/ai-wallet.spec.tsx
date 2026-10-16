import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { AiWalletComponent, walletDollars } from '../../apps/frontend/src/components/billing/ai-wallet.component';

let mockUser = { id: 'user', orgId: 'org-a', role: 'ADMIN' as 'USER' | 'ADMIN' | 'SUPERADMIN',
  tier: { prepaid_ai: true } };
const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => mockUser }));
const offers = [{ id: 'usd_5', amountCents: 500 }, { id: 'usd_10', amountCents: 1000 },
  { id: 'usd_25', amountCents: 2500 }];
const snapshot = (organizationId = 'org-a') => ({ organizationId, currency: 'usd', status: 'ACTIVE',
  balanceNanos: '1230000000', heldNanos: '5000000', availableNanos: '1225000000',
  operations: [{ id: 'pending', provider: 'openai', model: 'fixture', state: 'UNKNOWN',
    ceilingNanos: '5000000', chargedNanos: null, createdAt: '2035-01-01T00:00:00Z' },
    { id: 'settled', provider: 'openai', model: 'fixture', state: 'SETTLED',
      ceilingNanos: '4000000', chargedNanos: '1', createdAt: '2035-01-01T00:00:00Z' }],
  entries: [{ id: 'usage', kind: 'USAGE', amountNanos: '1', createdAt: '2035-01-01T00:00:00Z' }] });
const response = (value: any, ok = true) => ({ ok, json: async () => value });
const api = (balance: any = snapshot(), topup: (body: any) => any = () => response({
  topupId: 'topup', status: 'open', url: 'https://checkout.stripe.com/c/pay/synthetic',
})) => mockFetch.mockImplementation(async (path: string, options?: RequestInit) => {
  if (path === '/billing/ai-wallet') return response(balance);
  if (path === '/billing/ai-wallet/offers') return response(offers);
  if (path === '/billing/ai-wallet/topups' && options?.method === 'POST') return topup(JSON.parse(String(options.body)));
  throw Error('Unexpected request');
});
const mount = (navigate = jest.fn()) => {
  const cache = new Map();
  return { navigate, view: render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
    <AiWalletComponent navigate={navigate} /></SWRConfig>) };
};
beforeEach(() => {
  mockUser = { id: 'user', orgId: 'org-a', role: 'ADMIN', tier: { prepaid_ai: true } }; mockFetch.mockReset();
  sessionStorage.clear(); window.history.replaceState({}, '', '/billing');
});
afterEach(cleanup);

it('formats exact nano-USD amounts without rounding small charges to zero', () => {
  expect(walletDollars('1')).toBe('$0.000000001'); expect(walletDollars('10000000')).toBe('$0.01');
  expect(walletDollars('9007199254740993000')).toBe('$9007199254.740993');
  expect(walletDollars('0')).toBe('$0.00'); expect(walletDollars('-1')).toBe('Unavailable');
});
it('shows server offers with pending and settled costs while initial requests remain reads', async () => {
  api(); mount();
  expect(await screen.findByText('Pending reconciliation · Reserved maximum $0.005')).toBeTruthy();
  expect(screen.getByText('Settled · Charged $0.000000001')).toBeTruthy();
  for (const amount of ['$5.00', '$10.00', '$25.00']) {
    expect(await screen.findByRole('button', { name: `Add ${amount} test balance` })).toBeTruthy();
  }
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  for (const [, options] of mockFetch.mock.calls) expect(options).toBeUndefined();
});
it('handles an unavailable wallet and retries a read to show empty history', async () => {
  let calls = 0;
  mockFetch.mockImplementation(async (path: string) => path === '/billing/ai-wallet/offers' ? response(offers)
    : calls++ ? response({ ...snapshot(), operations: [], entries: [] }) : response({}, false));
  mount(); expect(await screen.findByText('Prepaid AI balance is unavailable.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry balance' }));
  expect(await screen.findByText('No AI operations yet.')).toBeTruthy();
  expect(screen.getByText('No settled transactions yet.')).toBeTruthy();
});
it('rejects a mismatched organization snapshot instead of displaying its costs', async () => {
  api(snapshot('org-b')); mount();
  expect(await screen.findByText('Prepaid AI balance is unavailable.')).toBeTruthy();
  expect(screen.queryByText('$1.225')).toBeNull();
});
it('clears previous tenant data while a different organization is loading', async () => {
  const cache = new Map();
  const ui = () => <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><AiWalletComponent /></SWRConfig>;
  api(); const view = render(ui()); expect(await screen.findByText('$1.225')).toBeTruthy();
  let complete!: (value: any) => void;
  mockFetch.mockImplementation((path: string) => path === '/billing/ai-wallet/offers' ? Promise.resolve(response(offers))
    : new Promise((resolve) => { complete = resolve; }));
  mockUser = { id: 'user', orgId: 'org-b', role: 'ADMIN', tier: { prepaid_ai: true } }; view.rerender(ui());
  expect(screen.queryByText('$1.225')).toBeNull(); await waitFor(() => expect(complete).toBeDefined());
  complete(response({ ...snapshot('org-b'), status: 'REVIEW', operations: [], entries: [] }));
  expect(await screen.findByText('Usage needs reconciliation. Pending amounts remain reserved.')).toBeTruthy();
});
it.each([
  ['non-administrator', 'USER' as const, true],
  ['plan without prepaid AI', 'ADMIN' as const, false],
])('hides offers from a %s', async (_case, role, prepaid_ai) => {
  mockUser = { id: 'user', orgId: 'org-a', role, tier: { prepaid_ai } }; api(); mount();
  expect(await screen.findByText('$1.225')).toBeTruthy();
  expect(screen.queryByText('Add test balance')).toBeNull();
  expect(mockFetch.mock.calls.some(([path]) => path === '/billing/ai-wallet/offers')).toBe(false);
});
it('rejects unsafe redirects and reuses one operation key after ambiguous failures', async () => {
  const bodies: any[] = []; let attempt = 0;
  api(snapshot(), (body) => {
    bodies.push(body); attempt++;
    if (attempt === 1) return response({}, false);
    return response({ topupId: 'topup', status: 'open', url: attempt === 2
      ? 'https://checkout.stripe.com.evil.example/pay' : 'https://checkout.stripe.com/c/pay/synthetic' });
  });
  const { navigate } = mount();
  const button = await screen.findByRole('button', { name: 'Add $5.00 test balance' });
  fireEvent.click(button);
  expect(await screen.findByText('Could not open secure test checkout. Retry uses the same purchase request.')).toBeTruthy();
  fireEvent.click(button); await waitFor(() => expect(bodies).toHaveLength(2));
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/synthetic'));
  expect(new Set(bodies.map((value) => value.operationKey)).size).toBe(1);
  expect(bodies[0].offerId).toBe('usd_5');
});
it('keeps one key through cancellation, return and an ambiguous server state', async () => {
  const bodies: any[] = [];
  api(snapshot(), (body) => { bodies.push(body); return response({
    topupId: 'topup', status: 'open', url: 'https://checkout.stripe.com/c/pay/synthetic',
  }); });
  window.history.replaceState({}, '', '/billing?wallet=cancel');
  let mounted = mount(), button = await screen.findByRole('button', { name: 'Add $10.00 test balance' });
  fireEvent.click(button); await waitFor(() => expect(bodies).toHaveLength(1)); mounted.view.unmount();
  mounted = mount(); button = await screen.findByRole('button', { name: 'Add $10.00 test balance' });
  fireEvent.click(button); await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1].operationKey).toBe(bodies[0].operationKey); mounted.view.unmount();
  window.history.replaceState({}, '', '/billing?wallet=return');
  mount(); button = await screen.findByRole('button', { name: 'Add $10.00 test balance' });
  fireEvent.click(button); await waitFor(() => expect(bodies).toHaveLength(3));
  expect(bodies[2].operationKey).toBe(bodies[0].operationKey);
});
it('refreshes the server snapshot for funded status without changing credit locally', async () => {
  let balanceReads = 0;
  mockFetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/billing/ai-wallet') { balanceReads++; return response(snapshot()); }
    if (path === '/billing/ai-wallet/offers') return response(offers);
    if (path === '/billing/ai-wallet/topups' && options?.method === 'POST') {
      return response({ topupId: 'topup', status: 'funded', url: null });
    }
    throw Error('Unexpected request');
  });
  const { navigate } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Add $25.00 test balance' }));
  expect(await screen.findByText('Payment is already recorded. Refreshing the server balance…')).toBeTruthy();
  await waitFor(() => expect(balanceReads).toBeGreaterThan(1));
  expect(sessionStorage).toHaveLength(0); expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByText('$1.225')).toBeTruthy();
});
