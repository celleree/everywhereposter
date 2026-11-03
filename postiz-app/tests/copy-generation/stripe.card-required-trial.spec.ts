import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: class {} }));

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  customers: { update: (...args: any[]) => mockUpdate(...args) },
  promotionCodes: { list: jest.fn().mockResolvedValue({ data: [] }) },
  checkout: { sessions: { create: (...args: any[]) => mockCreate(...args) } },
})) }));

describe('card-required subscription checkout', () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue({ url: 'https://checkout.test/session', client_secret: 'synthetic_session_secret' });
    mockUpdate.mockResolvedValue({});
  });

  it.each([
    ...['hosted', 'embedded'].flatMap(mode => ['MONTHLY', 'YEARLY'].flatMap(period =>
      [false, true].map(eligible => [mode, period, eligible]))),
  ])('collects a card for %s %s checkout with trial eligibility %s', async (mode, period, eligible) => {
    const service = new StripeService({} as any, {} as any, {
      getUserById: jest.fn().mockResolvedValue({ email: 'fixture@example.test' }),
    } as any, {} as any);
    const method = mode === 'hosted' ? 'createCheckoutSession' : 'createEmbeddedCheckout';
    // Exercise the SDK payload builders without any Stripe network access.
    await (service as any)[method]('org_fixture', 'operation_fixture', 'cus_fixture', {
      billing: 'STANDARD', period,
    }, 'price_existing', 'user_fixture', eligible);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0][0];
    expect(payload).toMatchObject({
      mode: 'subscription', customer: 'cus_fixture',
      payment_method_collection: 'always', payment_method_types: ['card'],
      line_items: [{ price: 'price_existing', quantity: 1 }],
      subscription_data: { metadata: { billing: 'STANDARD', period, userId: 'user_fixture' } },
    });
    if (eligible) expect(payload.subscription_data.trial_period_days).toBe(7);
    else expect(payload.subscription_data).not.toHaveProperty('trial_period_days');
    if (mode === 'hosted') {
      expect(payload.custom_text.submit.message).toBe(
        'Your subscription automatically renews at the recurring price and billing interval shown here until you cancel. ' +
        'Cancel from Billing in your account before your next billing date to stop future renewals.' +
        (eligible ? ' If a free trial is shown, it converts to a paid subscription when the trial ends unless you cancel before then.' : '') +
        ' [Terms of Service](https://everywhereposter.com/terms/).'
      );
      expect(payload.custom_text.submit.message.length).toBeLessThanOrEqual(1200);
    } else expect(payload).not.toHaveProperty('custom_text');
  });
});
