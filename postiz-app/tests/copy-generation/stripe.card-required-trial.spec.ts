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
  checkout: { sessions: { create: (...args: any[]) => mockCreate(...args) } },
})) }));

describe('card-required subscription checkout', () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue({ url: 'https://checkout.test/session', client_secret: 'synthetic_session_secret' });
    mockUpdate.mockResolvedValue({});
  });

  it.each([
    ['hosted', false], ['hosted', true], ['embedded', false], ['embedded', true],
  ])('collects a card for %s checkout with trial eligibility %s', async (mode, eligible) => {
    const service = new StripeService({} as any, {} as any, {
      getUserById: jest.fn().mockResolvedValue({ email: 'fixture@example.test' }),
    } as any, {} as any);
    const method = mode === 'hosted' ? 'createCheckoutSession' : 'createEmbeddedCheckout';
    // Exercise the SDK payload builders without any Stripe network access.
    await (service as any)[method]('org_fixture', 'operation_fixture', 'cus_fixture', {
      billing: 'STANDARD', period: 'YEARLY',
    }, 'price_existing', 'user_fixture', eligible);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0][0];
    expect(payload).toMatchObject({
      mode: 'subscription', customer: 'cus_fixture',
      payment_method_collection: 'always', payment_method_types: ['card'],
      line_items: [{ price: 'price_existing', quantity: 1 }],
      subscription_data: { metadata: { billing: 'STANDARD', period: 'YEARLY', userId: 'user_fixture' } },
    });
    if (eligible) expect(payload.subscription_data.trial_period_days).toBe(7);
    else expect(payload.subscription_data).not.toHaveProperty('trial_period_days');
  });
});
