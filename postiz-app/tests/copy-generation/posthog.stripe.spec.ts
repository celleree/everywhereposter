const mockRetrieve = jest.fn();
const mockConversion = jest.fn().mockResolvedValue(undefined);
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  subscriptions: { retrieve: mockRetrieve },
})) }));
jest.mock('@gitroom/nestjs-libraries/track/posthog.conversions', () => ({
  captureBillingConversion: (...args: any[]) => mockConversion(...args),
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

function service() {
  const instance = new StripeService(
    { createOrUpdateSubscription: jest.fn().mockResolvedValue({ id: 'saved' }) } as any,
    {} as any, { getUserById: jest.fn().mockResolvedValue({ id: 'user' }) } as any,
    { track: jest.fn() } as any,
  );
  instance.checkValidCard = jest.fn().mockResolvedValue(true);
  return instance;
}
const subscription = (status = 'trialing') => ({ livemode: true, data: { object: {
  id: 'sub', created: 100, status, customer: 'customer',
  metadata: { service: 'gitroom', userId: 'user', billing: 'STANDARD', period: 'MONTHLY', uniqueId: 'org' },
} } });

it('emits a trial only after accepted card and successful subscription persistence', async () => {
  const instance = service();
  expect(await instance.createSubscription(subscription() as any)).toEqual({ id: 'saved' });
  expect(mockConversion).toHaveBeenCalledWith('trial_started', 'user', 'sub', 100);
  mockConversion.mockClear();
  (instance.checkValidCard as jest.Mock).mockResolvedValue(false);
  await instance.createSubscription(subscription() as any);
  expect(mockConversion).not.toHaveBeenCalled();
});
it('does not infer trials from active subscriptions or failed persistence', async () => {
  const instance = service();
  await instance.createSubscription(subscription('active') as any);
  expect(mockConversion).not.toHaveBeenCalled();
  (instance as any)._subscriptionService.createOrUpdateSubscription.mockRejectedValue(new Error('database'));
  await expect(instance.createSubscription(subscription() as any)).rejects.toThrow('database');
  expect(mockConversion).not.toHaveBeenCalled();
});
it('only emits a positive confirmed payment belonging to this app, never the zero-dollar trial invoice', async () => {
  const instance = service();
  mockRetrieve.mockResolvedValue(subscription().data.object);
  const invoice = { livemode: true, data: { object: {
    id: 'invoice', created: 200, amount_paid: 0,
    parent: { subscription_details: { subscription: 'sub' } },
  } } };
  await instance.paymentSucceeded(invoice as any);
  expect(mockConversion).not.toHaveBeenCalled();
  invoice.data.object.amount_paid = 100;
  await instance.paymentSucceeded(invoice as any);
  expect(mockConversion).toHaveBeenCalledWith('subscription_payment_completed', 'user', 'invoice', 200);
  mockConversion.mockClear();
  mockRetrieve.mockResolvedValue({ metadata: { userId: 'user' } });
  await instance.paymentSucceeded(invoice as any);
  expect(mockConversion).not.toHaveBeenCalled();
});

it('excludes Stripe test-mode conversions', async () => {
  const instance = service();
  await instance.createSubscription({ ...subscription(), livemode: false } as any);
  mockRetrieve.mockResolvedValue(subscription().data.object);
  await instance.paymentSucceeded({ livemode: false, data: { object: {
    id: 'invoice', created: 200, amount_paid: 100,
    parent: { subscription_details: { subscription: 'sub' } },
  } } } as any);
  expect(mockConversion).not.toHaveBeenCalled();
});
