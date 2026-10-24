import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { channelAllowance, pricing, purchasePlans } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: class {} }));
const mockPrices = jest.fn();
const mockProducts = jest.fn();
const mockPriceCreate = jest.fn();
const mockCheckout = jest.fn();
const mockPromo = jest.fn();
const mockSubscriptions = jest.fn(), mockSubscriptionUpdate = jest.fn();
const mockSessions = jest.fn(), mockRetrieve = jest.fn(), mockExpire = jest.fn(), mockCustomerCreate = jest.fn();
let sessions: Map<string, any>;
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  prices: { list: (...args: any[]) => mockPrices(...args), create: (...args: any[]) => mockPriceCreate(...args) },
  products: { list: (...args: any[]) => mockProducts(...args), create: (...args: any[]) => mockProducts(...args) },
  subscriptions: { list: (...args: any[]) => mockSubscriptions(...args), update: (...args: any[]) => mockSubscriptionUpdate(...args) },
  customers: { update: jest.fn(), create: (...args: any[]) => mockCustomerCreate(...args) }, promotionCodes: { list: (...args: any[]) => mockPromo(...args) },
  checkout: { sessions: { create: (...args: any[]) => mockCheckout(...args), list: (...args: any[]) => mockSessions(...args),
    retrieve: (...args: any[]) => mockRetrieve(...args), expire: (...args: any[]) => mockExpire(...args) } },
})) }));
const validPrice = (period = 'MONTHLY') => ({
  id: 'price_approved', active: true, currency: 'usd', type: 'recurring', billing_scheme: 'per_unit',
  unit_amount: period === 'MONTHLY' ? 900 : 9000,
  recurring: { interval: period === 'MONTHLY' ? 'month' : 'year', interval_count: 1 },
  lookup_key: period === 'MONTHLY' ? 'everywhereposter_launch_v1_monthly' : 'everywhereposter_launch_v1_yearly',
  metadata: { plan_version: 'LAUNCH_V1' },
});
const harness = (tier?: string) => {
  // A small service-port fake; real row locks, constraints and CAS are covered
  // separately by stripe.launch-checkout.integration.spec.ts on PostgreSQL.
  const attempts: any[] = [];
  const subscription = { getSubscription: jest.fn().mockResolvedValue(tier ? { subscriptionTier: tier } : null),
    createOrUpdateSubscription: jest.fn(), reconcileLaunchSubscription: jest.fn(),
    getLaunchCustomer: jest.fn().mockResolvedValue({ paymentId: 'cus_fixture', allowTrial: true }),
    claimLaunchCheckout: jest.fn(async (organizationId, customerId, proposal, token) => {
      if (await subscription.getSubscription()) throw Error('Subscription exists');
      let attempt = attempts.find(a => a.state !== 'CLOSED');
      if (attempt?.leaseUntil > new Date(Date.now())) throw Error('Launch checkout is pending');
      if (!attempt) {
        const { allowTrial: _allowTrial, ...identity } = proposal;
        attempt = { ...identity, organizationId, customerId, sessionId: null, state: 'PREPARED', firstDispatchedAt: null };
        attempts.push(attempt);
      }
      Object.assign(attempt, { leaseToken: token, leaseUntil: new Date(Date.now() + 120000) });
      return { ...attempt };
    }),
    transitionLaunchCheckout: jest.fn(async (attempt, states, data) => {
      const row = attempts.find(a => a.id === attempt.id);
      if (!row || row.leaseToken !== attempt.leaseToken || row.leaseUntil <= new Date(Date.now()) || !states.includes(row.state)) {
        throw Error('Checkout ownership changed');
      }
      Object.assign(row, data);
      return { ...row };
    }),
    releaseLaunchCheckout: jest.fn(async attempt => {
      const row = attempts.find(a => a.id === attempt.id);
      if (row?.leaseToken === attempt.leaseToken) Object.assign(row, { leaseToken: null, leaseUntil: null });
    }),
  };
  const service = new StripeService(subscription as any, { getOrgById: jest.fn().mockResolvedValue({ paymentId: 'cus_fixture' }) } as any,
    { getUserById: jest.fn().mockResolvedValue({ email: 'fixture@example.test' }) } as any, {} as any);
  return { service, subscription, attempts };
};
const savedBilling = process.env.BILLING_ENABLED;
afterAll(() => { if (savedBilling === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = savedBilling; });
beforeEach(() => {
  process.env.BILLING_ENABLED = 'true';
  sessions = new Map();
  mockPrices.mockResolvedValue({ data: [validPrice()] });
  mockSubscriptions.mockResolvedValue({ data: [], has_more: false });
  mockSessions.mockImplementation(async () => ({ data: [...sessions.values()], has_more: false }));
  mockRetrieve.mockImplementation(async id => ({ ...sessions.get(id) }));
  mockCheckout.mockImplementation(async params => {
    const id = `cs_fixture_${sessions.size + 1}`;
    const session = { ...params, id, status: 'open', subscription: null,
      line_items: { data: [{ price: validPrice(params.subscription_data.metadata.period), quantity: 1 }], has_more: false },
      url: `https://checkout.stripe.com/c/pay/${id}`, client_secret: `${id}_secret` };
    sessions.set(id, session);
    return { ...session };
  });
  mockExpire.mockImplementation(async id => {
    const session = sessions.get(id);
    session.status = 'expired';
    return { ...session };
  });
});

it('represents the approved versioned plan without granting bundled AI or altering legacy prices', () => {
  expect(pricing.LAUNCH_V1).toMatchObject({ month_price: 9, year_price: 90, unlimited_channels: true, unlimited_posts: true,
    team_members: false, prepaid_ai: true, ai: false, public_api: false, webhooks: 0, autoPost: false });
  expect(channelAllowance({ subscriptionTier: 'LAUNCH_V1', totalChannels: 0 })).toBe(Infinity);
  expect(channelAllowance({ subscriptionTier: 'PRO', totalChannels: 37 })).toBe(37);
  expect(purchasePlans().map(([key]) => key)).toEqual(['LAUNCH_V1']);
  expect(purchasePlans('PRO').map(([key]) => key)).toEqual(['STANDARD', 'TEAM', 'PRO', 'ULTIMATE']);
  expect(pricing.STANDARD.month_price).toBe(29);
});

it.each(['embedded', 'subscribe', 'prorate'])('rejects forged legacy %s before any Stripe call', async (method) => {
  const { service } = harness();
  const body = { billing: 'PRO', period: 'MONTHLY' };
  const result = method === 'prorate' ? (service as any)[method]('org_fixture', body) : (service as any)[method]('track', 'org_fixture', 'user', body, true);
  await expect(result).rejects.toThrow('existing legacy subscribers');
  expect(mockPrices).not.toHaveBeenCalled(); expect(mockProducts).not.toHaveBeenCalled(); expect(mockCheckout).not.toHaveBeenCalled();
});

it.each(['subscribe', 'embedded'].flatMap(method => ['MONTHLY', 'YEARLY'].flatMap(period =>
  [true, false].map(eligible => [method, period, eligible]))))('builds %s %s Checkout (trial eligible=%s)', async (method, period, eligible) => {
  mockPrices.mockResolvedValue({ data: [validPrice(period)] });
  const { service } = harness();
  await (service as any)[method]('track', 'org_fixture', 'user', { billing: 'LAUNCH_V1', period } as any, eligible);
  expect(mockPrices).toHaveBeenCalledWith({ active: true, lookup_keys: [validPrice(period).lookup_key], limit: 2 },
    { timeout: 10000, maxNetworkRetries: 0 });
  expect(mockProducts).not.toHaveBeenCalled(); expect(mockPriceCreate).not.toHaveBeenCalled();
  expect(mockCheckout.mock.calls[0][0]).toMatchObject({ payment_method_collection: 'always', payment_method_types: ['card'],
    allow_promotion_codes: false, subscription_data: { metadata: { billing: 'LAUNCH_V1' } },
    line_items: [{ price: 'price_approved', quantity: 1 }] });
  const payload = mockCheckout.mock.calls[0][0];
  if (eligible) expect(payload.subscription_data.trial_period_days).toBe(7);
  else expect(payload.subscription_data).not.toHaveProperty('trial_period_days');
  if (method === 'embedded') expect(payload.ui_mode).toBe('custom');
  expect(payload.client_reference_id).toBe(payload.metadata.launchAttemptId);
  expect(payload.metadata.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(mockCheckout.mock.calls[0][1]).toMatchObject({ timeout: 10000, maxNetworkRetries: 0,
    idempotencyKey: `launch-checkout:${payload.client_reference_id}` });
});

const launch = (service: StripeService, method = 'subscribe', period = 'MONTHLY') =>
  (service as any)[method]('track', 'org_fixture', 'user', { billing: 'LAUNCH_V1', period }, true);

it.each(['subscribe', 'embedded'])('reuses one verified matching %s session without storing a client secret', async method => {
  const { service, attempts } = harness();
  const first = await launch(service, method);
  expect(await launch(service, method)).toEqual(first);
  expect(mockCheckout).toHaveBeenCalledTimes(1);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ state: 'OPEN', sessionId: 'cs_fixture_1', leaseToken: null });
  expect(JSON.stringify(attempts)).not.toContain('client_secret');
});

it('refuses a hosted/embedded mismatch without creating or expiring another session', async () => {
  const { service } = harness();
  await launch(service);
  await expect(launch(service, 'embedded')).rejects.toThrow('mode or contract changed');
  expect(mockCheckout).toHaveBeenCalledTimes(1);
  expect(mockExpire).not.toHaveBeenCalled();
});

it('replaces a period only after verified expiry and retains the old attempt', async () => {
  const { service, attempts } = harness();
  await launch(service);
  mockPrices.mockResolvedValue({ data: [validPrice('YEARLY')] });
  await launch(service, 'subscribe', 'YEARLY');
  expect(mockExpire).toHaveBeenCalledTimes(1);
  expect(mockCheckout).toHaveBeenCalledTimes(2);
  expect(attempts.map(a => a.state)).toEqual(['CLOSED', 'OPEN']);
  expect(attempts[0].sessionId).not.toBe(attempts[1].sessionId);
});

it('does not replace when completion wins expiration', async () => {
  const { service, attempts } = harness();
  await launch(service);
  mockPrices.mockResolvedValue({ data: [validPrice('YEARLY')] });
  mockExpire.mockImplementationOnce(async id => {
    Object.assign(sessions.get(id), { status: 'complete', subscription: 'sub_settling' });
    throw Error('already completed');
  });
  await expect(launch(service, 'subscribe', 'YEARLY')).rejects.toThrow('completed before replacement');
  expect(mockCheckout).toHaveBeenCalledTimes(1);
  expect(attempts[0].state).toBe('SETTLEMENT_PENDING');
});

it.each([
  { field: 'metadata', value: {} }, { field: 'ui_mode', value: 'custom' },
  { field: 'customer', value: 'cus_other' }, { field: 'payment_method_collection', value: 'if_required' },
  { field: 'allow_promotion_codes', value: true },
  { field: 'line_items', value: { data: [], has_more: false } },
  { field: 'after_expiration', value: { recovery: { enabled: true } } },
])('refuses unverified session contract: $field', async ({ field, value }) => {
  const { service } = harness();
  await launch(service);
  sessions.get('cs_fixture_1')[field] = value;
  await expect(launch(service)).rejects.toThrow();
  expect(mockCheckout).toHaveBeenCalledTimes(1);
});

it.each(['checkout', 'subscription'])('fails closed on incomplete %s history before any checkout POST', async kind => {
  const { service } = harness();
  (kind === 'checkout' ? mockSessions : mockSubscriptions).mockResolvedValue({ data: [], has_more: true });
  await expect(launch(service)).rejects.toThrow('history is incomplete');
  expect(mockCheckout).not.toHaveBeenCalled();
});

it('requires an explicit complete-history marker rather than assuming it', async () => {
  const { service } = harness();
  mockSessions.mockResolvedValue({ data: [] });
  await expect(launch(service)).rejects.toThrow('history is incomplete');
  expect(mockCheckout).not.toHaveBeenCalled();
});

it('refuses unknown open subscription sessions and unknown settlement', async () => {
  const { service } = harness();
  sessions.set('cs_unknown', { id: 'cs_unknown', customer: 'cus_fixture', mode: 'subscription', status: 'open' });
  await expect(launch(service)).rejects.toThrow('unknown checkout');
  sessions.get('cs_unknown').status = 'complete';
  await expect(launch(service)).rejects.toThrow('unknown checkout');
  expect(mockCheckout).not.toHaveBeenCalled();
});

it('refuses multiple matching sessions rather than picking one', async () => {
  const { service } = harness();
  await launch(service);
  sessions.set('cs_duplicate', { ...sessions.get('cs_fixture_1'), id: 'cs_duplicate' });
  await expect(launch(service)).rejects.toThrow('Multiple checkout identities');
  expect(mockCheckout).toHaveBeenCalledTimes(1);
});

it('keeps an uncertain dispatched identity and stops retrying it after 23 hours', async () => {
  const { service, attempts } = harness();
  mockCheckout.mockRejectedValueOnce(Error('response lost'));
  await expect(launch(service)).rejects.toThrow('response lost');
  const first = mockCheckout.mock.calls[0];
  mockCheckout.mockRejectedValueOnce(Error('still uncertain'));
  await expect(launch(service)).rejects.toThrow('still uncertain');
  expect(mockCheckout.mock.calls[1]).toEqual(first);
  const now = jest.spyOn(Date, 'now').mockReturnValue(attempts[0].firstDispatchedAt.getTime() + 24 * 60 * 60 * 1000);
  try {
    await expect(launch(service)).rejects.toThrow('beyond the retry window');
    expect(mockCheckout).toHaveBeenCalledTimes(2);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].state).toBe('REVIEW');
  } finally { now.mockRestore(); }
});

it.each(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])('blocks provider subscription status %s', async status => {
  const { service } = harness();
  mockSubscriptions.mockResolvedValue({ has_more: false, data: [{ id: 'sub_exists', customer: 'cus_fixture', status }] });
  await expect(launch(service)).rejects.toThrow('subscription exists');
  expect(mockCheckout).not.toHaveBeenCalled();
});

it('does not silently convert a legacy subscriber to the launch plan', async () => {
  const { service } = harness('PRO');
  await expect(service.embedded('track', 'org_fixture', 'user', { billing: 'LAUNCH_V1', period: 'MONTHLY' } as any, false)).rejects.toThrow('explicit migration');
  expect(mockPrices).not.toHaveBeenCalled();
});

it.each([
  [], [validPrice(), validPrice()], [{ ...validPrice(), unit_amount: 901 }],
  [{ ...validPrice(), currency: 'eur' }], [{ ...validPrice(), metadata: {} }],
  [{ ...validPrice(), recurring: { interval: 'month', interval_count: 2 } }],
  [{ ...validPrice(), lookup_key: 'unversioned' }], [{ ...validPrice(), billing_scheme: 'tiered' }],
])('fails closed for absent, ambiguous, or changed price configuration %#', async (...args: any[]) => {
  const data = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  mockPrices.mockResolvedValue({ data });
  const { service } = harness();
  await expect(service.subscribe('track', 'org_fixture', 'user', { billing: 'LAUNCH_V1', period: 'MONTHLY' } as any, true)).rejects.toThrow('not configured');
  expect(mockCheckout).not.toHaveBeenCalled(); expect(mockPriceCreate).not.toHaveBeenCalled();
});

it.each(['createSubscription', 'updateSubscription'])('validates actual event price and quantity before %s grants entitlements', async (method) => {
  const { service, subscription } = harness();
  const checkCard = jest.spyOn(service, 'checkValidCard').mockResolvedValue(true);
  const event = { data: { object: { status: 'active', customer: 'cus_fixture', cancel_at: null,
    metadata: { uniqueId: 'track', billing: 'LAUNCH_V1', period: 'MONTHLY' }, items: { data: [{ price: validPrice(), quantity: 2 }] } } } };
  await expect((service as any)[method](event)).rejects.toThrow('approved launch price');
  expect(checkCard).not.toHaveBeenCalled(); expect(subscription.createOrUpdateSubscription).not.toHaveBeenCalled();
  event.data.object.items.data[0].quantity = 1;
  await (service as any)[method](event);
  expect(subscription.reconcileLaunchSubscription).toHaveBeenCalledWith('cus_fixture', expect.any(Function));
  expect(subscription.createOrUpdateSubscription).not.toHaveBeenCalled();
});

it.each(['embedded', 'subscribe', 'prorate'])('rejects a lifetime %s without creating a second paid subscription', async (method) => {
  const { service, subscription } = harness('PRO');
  subscription.getSubscription.mockResolvedValue({ subscriptionTier: 'PRO', isLifetime: true });
  const body = { billing: 'PRO', period: 'MONTHLY' };
  const result = method === 'prorate' ? (service as any)[method]('org_fixture', body) : (service as any)[method]('track', 'org_fixture', 'user', body, true);
  await expect(result).rejects.toThrow('Lifetime subscriptions');
  expect(mockPrices).not.toHaveBeenCalled(); expect(mockProducts).not.toHaveBeenCalled(); expect(mockCheckout).not.toHaveBeenCalled();
});

it('binds an existing Launch period change to the new webhook/polling checkpoint', async () => {
  const { service } = harness('LAUNCH_V1');
  mockPrices.mockResolvedValue({ data: [validPrice('YEARLY')] });
  mockSubscriptions.mockResolvedValue({ data: [{ id: 'sub_existing', status: 'active', items: { data: [{ id: 'item_existing' }] } }] });
  mockSubscriptionUpdate.mockResolvedValue({});
  const result = await service.subscribe('tracking_cookie', 'org_fixture', 'user', { billing: 'LAUNCH_V1', period: 'YEARLY' } as any, false);
  expect(result).toHaveProperty('id');
  if (!('id' in result)) throw Error('Expected subscription checkpoint');
  expect(mockSubscriptionUpdate).toHaveBeenCalledWith('sub_existing', expect.objectContaining({
    metadata: expect.objectContaining({ billing: 'LAUNCH_V1', period: 'YEARLY', id: result.id, uniqueId: result.id, ud: 'tracking_cookie' }),
    items: [{ id: 'item_existing', price: 'price_approved', quantity: 1 }],
  }));
});
