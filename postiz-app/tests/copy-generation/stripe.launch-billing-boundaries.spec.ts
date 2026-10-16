import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { BillingController } from '../../apps/backend/src/api/routes/billing.controller';
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/crypto/nowpayments', () => ({ Nowpayments: class {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: class {} }));
const mockList = jest.fn(), mockUpdate = jest.fn(), mockCharges = jest.fn(), mockPortal = jest.fn(), mockConfig = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  subscriptions: { list: (...args: any[]) => mockList(...args), update: (...args: any[]) => mockUpdate(...args) },
  charges: { list: (...args: any[]) => mockCharges(...args) },
  billingPortal: { sessions: { create: (...args: any[]) => mockPortal(...args) }, configurations: { retrieve: (...args: any[]) => mockConfig(...args) } },
})) }));
const subscription = (launch = false) => ({ id: 'sub_fixture', status: 'active', metadata: { billing: launch ? 'LAUNCH_V1' : 'PRO' }, discounts: [],
  items: { data: [{ price: { recurring: { interval: 'month' }, metadata: {}, lookup_key: launch ? 'everywhereposter_launch_v1_monthly' : null } }] } });
const config = () => ({ active: true, metadata: { plan_version: 'LAUNCH_V1' }, features: {
  subscription_update: { enabled: false }, payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
} });
const service = () => new StripeService({} as any, {} as any, {} as any, {} as any);
const keys = ['BILLING_ENABLED', 'STRIPE_DISCOUNT_ID', 'STRIPE_LAUNCH_PORTAL_CONFIGURATION', 'FRONTEND_URL'];
const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
beforeEach(() => {
  process.env.BILLING_ENABLED = 'true'; process.env.STRIPE_DISCOUNT_ID = 'coupon_fixture'; process.env.FRONTEND_URL = 'http://localhost:4200';
  delete process.env.STRIPE_LAUNCH_PORTAL_CONFIGURATION;
  mockList.mockResolvedValue({ data: [subscription()], has_more: false }); mockCharges.mockResolvedValue({ data: [{ amount: 2500 }] });
  mockPortal.mockResolvedValue({ url: 'https://billing.stripe.com/fixture' }); mockConfig.mockResolvedValue(config());
});
afterAll(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
it.each([false, true])('rejects launch retention discount using metadata or price identity (priceOnly=%s)', async (priceOnly) => {
  const sub = subscription(true); if (priceOnly) sub.metadata.billing = 'PRO'; mockList.mockResolvedValue({ data: [sub] });
  await expect(service().applyDiscount('cus_fixture')).resolves.toBe(false); expect(mockUpdate).not.toHaveBeenCalled();
});
it('awaits negative eligibility before a discount mutation', async () => {
  mockCharges.mockResolvedValue({ data: [] }); await expect(service().applyDiscount('cus_fixture')).resolves.toBe(false);
  expect(mockUpdate).not.toHaveBeenCalled(); expect(mockList).not.toHaveBeenCalled();
});
it('preserves an eligible legacy discount', async () => {
  await expect(service().applyDiscount('cus_fixture')).resolves.toBe(true);
  expect(mockUpdate).toHaveBeenCalledWith('sub_fixture', { discounts: [{ coupon: 'coupon_fixture' }] });
});
it('rechecks provider plan before applying the coupon after eligibility', async () => {
  mockList.mockResolvedValueOnce({ data: [subscription()] }).mockResolvedValueOnce({ data: [subscription(true)] });
  await expect(service().applyDiscount('cus_fixture')).resolves.toBe(false); expect(mockUpdate).not.toHaveBeenCalled();
});
it.each(['active', 'canceled'])('requires a safe configured portal for current or canceled launch history (%s)', async (status) => {
  mockList.mockResolvedValue({ data: [{ ...subscription(true), status }], has_more: false });
  await expect(service().createBillingPortalLink('cus_fixture')).rejects.toThrow('temporarily unavailable'); expect(mockPortal).not.toHaveBeenCalled();
});
it('does not assume an incomplete subscription history is legacy', async () => {
  mockList.mockResolvedValue({ data: [subscription()], has_more: true });
  await expect(service().createBillingPortalLink('cus_fixture')).rejects.toThrow('temporarily unavailable'); expect(mockPortal).not.toHaveBeenCalled();
});
it.each(['update', 'payment', 'immediate', 'prorate', 'retention', 'version', 'inactive'])('rejects unsafe launch portal configuration (%s)', async (change) => {
  process.env.STRIPE_LAUNCH_PORTAL_CONFIGURATION = 'bpc_fixture'; mockList.mockResolvedValue({ data: [subscription(true)] });
  const value: any = config();
  if (change === 'update') value.features.subscription_update.enabled = true;
  if (change === 'payment') value.features.payment_method_update.enabled = false;
  if (change === 'immediate') value.features.subscription_cancel.mode = 'immediately';
  if (change === 'prorate') value.features.subscription_cancel.proration_behavior = 'create_prorations';
  if (change === 'retention') value.features.subscription_cancel.retention = { coupon: 'unapproved' };
  if (change === 'version') value.metadata.plan_version = 'OTHER';
  if (change === 'inactive') value.active = false;
  mockConfig.mockResolvedValue(value);
  await expect(service().createBillingPortalLink('cus_fixture')).rejects.toThrow('temporarily unavailable'); expect(mockPortal).not.toHaveBeenCalled();
});
it('passes only a verified launch configuration to the portal', async () => {
  process.env.STRIPE_LAUNCH_PORTAL_CONFIGURATION = 'bpc_fixture'; mockList.mockResolvedValue({ data: [subscription(true)] });
  await service().createBillingPortalLink('cus_fixture');
  expect(mockConfig).toHaveBeenCalledWith('bpc_fixture');
  expect(mockPortal).toHaveBeenCalledWith({ customer: 'cus_fixture', configuration: 'bpc_fixture', return_url: 'http://localhost:4200/billing' });
});
it('preserves the legacy portal default when history is complete', async () => {
  await service().createBillingPortalLink('cus_fixture'); expect(mockConfig).not.toHaveBeenCalled();
  expect(mockPortal.mock.calls[0][0]).not.toHaveProperty('configuration');
});
it('rejects all remaining non-admin billing mutations before external side effects', async () => {
  const downstream = { applyDiscount: jest.fn(), finishTrial: jest.fn(), getCustomerByOrganizationId: jest.fn(), setToCancel: jest.fn(), lifetimeDeal: jest.fn() };
  const notifications = { sendEmail: jest.fn() }, crypto = { createPaymentPage: jest.fn() };
  const controller = new BillingController({} as any, downstream as any, notifications as any, crypto as any, {} as any);
  const org = { id: 'org_fixture', users: [{ role: 'USER' }] } as any;
  const requests = [controller.applyDiscount(org), controller.finishTrial(org), controller.modifyPayment(org), controller.cancel(org, {} as any, { feedback: '' }), controller.lifetime(org, { code: '' }), controller.crypto(org)];
  for (const request of requests) await expect(request).rejects.toThrow('administrator');
  for (const fn of [...Object.values(downstream), notifications.sendEmail, crypto.createPaymentPage]) expect(fn).not.toHaveBeenCalled();
});
it.each(['LAUNCH_V1', 'FREE', undefined])('rejects unapproved crypto sales for new/launch organizations (%s)', async (tier) => {
  const crypto = { createPaymentPage: jest.fn() };
  const controller = new BillingController({ getSubscription: jest.fn().mockResolvedValue(tier ? { subscriptionTier: tier } : null) } as any,
    {} as any, {} as any, crypto as any, {} as any);
  await expect(controller.crypto({ id: 'org_fixture', users: [{ role: 'SUPERADMIN' }] } as any)).rejects.toThrow('unavailable for this plan');
  expect(crypto.createPaymentPage).not.toHaveBeenCalled();
});

it('completes administrator cancellation even when the notification fails', async () => {
  const stripe = { setToCancel: jest.fn().mockResolvedValue({ cancel_at: 'fixture' }) };
  const notifications = { sendEmail: jest.fn().mockRejectedValue(Error('offline inbox')) };
  const controller = new BillingController({} as any, stripe as any, notifications as any, {} as any, {} as any);
  const result = await controller.cancel({ id: 'org_fixture', name: 'fixture', users: [{ role: 'SUPERADMIN' }] } as any,
    { email: 'fixture@example.test' } as any, { feedback: 'offline fixture' });
  expect(result).toEqual({ cancel_at: 'fixture' }); expect(stripe.setToCancel).toHaveBeenCalledWith('org_fixture');
  expect(stripe.setToCancel.mock.invocationCallOrder[0]).toBeLessThan(notifications.sendEmail.mock.invocationCallOrder[0]);
});
