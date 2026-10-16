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
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  prices: { list: (...args: any[]) => mockPrices(...args), create: (...args: any[]) => mockPriceCreate(...args) },
  products: { list: (...args: any[]) => mockProducts(...args), create: (...args: any[]) => mockProducts(...args) },
  subscriptions: { list: (...args: any[]) => mockSubscriptions(...args), update: (...args: any[]) => mockSubscriptionUpdate(...args) },
  customers: { update: jest.fn() }, promotionCodes: { list: (...args: any[]) => mockPromo(...args) },
  checkout: { sessions: { create: (...args: any[]) => mockCheckout(...args) } },
})) }));
const validPrice = (period = 'MONTHLY') => ({
  id: 'price_approved', active: true, currency: 'usd', type: 'recurring', billing_scheme: 'per_unit',
  unit_amount: period === 'MONTHLY' ? 900 : 9000,
  recurring: { interval: period === 'MONTHLY' ? 'month' : 'year', interval_count: 1 },
  lookup_key: period === 'MONTHLY' ? 'everywhereposter_launch_v1_monthly' : 'everywhereposter_launch_v1_yearly',
  metadata: { plan_version: 'LAUNCH_V1' },
});
const harness = (tier?: string) => {
  const subscription = { getSubscription: jest.fn().mockResolvedValue(tier ? { subscriptionTier: tier } : null), createOrUpdateSubscription: jest.fn() };
  const service = new StripeService(subscription as any, { getOrgById: jest.fn().mockResolvedValue({ paymentId: 'cus_fixture' }) } as any,
    { getUserById: jest.fn().mockResolvedValue({ email: 'fixture@example.test' }) } as any, {} as any);
  return { service, subscription };
};
const savedBilling = process.env.BILLING_ENABLED;
afterAll(() => { if (savedBilling === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = savedBilling; });
beforeEach(() => {
  process.env.BILLING_ENABLED = 'true';
  mockPrices.mockResolvedValue({ data: [validPrice()] });
  mockCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/fixture', client_secret: 'fixture_secret' });
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

it.each(['MONTHLY', 'YEARLY'])('uses the configured immutable %s launch price and card-required trial', async (period) => {
  mockPrices.mockResolvedValue({ data: [validPrice(period)] });
  const { service } = harness();
  await service.subscribe('track', 'org_fixture', 'user', { billing: 'LAUNCH_V1', period } as any, true);
  expect(mockPrices).toHaveBeenCalledWith({ active: true, lookup_keys: [validPrice(period).lookup_key], limit: 2 });
  expect(mockProducts).not.toHaveBeenCalled(); expect(mockPriceCreate).not.toHaveBeenCalled();
  expect(mockCheckout.mock.calls[0][0]).toMatchObject({ payment_method_collection: 'always', payment_method_types: ['card'],
    allow_promotion_codes: false, subscription_data: { trial_period_days: 7, metadata: { billing: 'LAUNCH_V1' } },
    line_items: [{ price: 'price_approved', quantity: 1 }] });
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
  expect(subscription.createOrUpdateSubscription).toHaveBeenCalledWith(false, 'track', 'cus_fixture', 0, 'LAUNCH_V1', 'MONTHLY', null);
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
