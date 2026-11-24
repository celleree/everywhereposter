import { BillingController } from '../../apps/backend/src/api/routes/billing.controller';
jest.mock('@prisma/client', () => ({}));
jest.mock('@gitroom/nestjs-libraries/services/stripe.service', () => ({ StripeService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/ai-wallet-checkout.service', () => ({ AiWalletCheckoutService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/ai-wallet-refund-request.service', () => ({ AiWalletRefundRequestService: class {} }));
jest.mock('@gitroom/nestjs-libraries/crypto/nowpayments', () => ({ Nowpayments: class {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: class {} }));

const previous = process.env.BILLING_ENABLED;
beforeEach(() => { process.env.BILLING_ENABLED = 'true'; });
afterAll(() => { if (previous === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = previous; });

it.each([undefined, {}, { feedback: '' }, { feedback: ' ' }, { feedback: 'short' }])(
  'cancels with optional feedback: %p', async (body) => {
    const stripe = { setToCancel: jest.fn().mockResolvedValue({ cancel_at: 'fixture' }) };
    const notifications = { sendEmail: jest.fn().mockRejectedValue(new Error('offline')) };
    const controller = new BillingController({} as any, stripe as any, notifications as any, {} as any, {} as any, {} as any);
    await expect(controller.cancel({ id: 'org_fixture', name: 'Fixture', users: [{ role: 'ADMIN' }] } as any,
      { email: 'fixture@example.test' } as any, body)).resolves.toEqual({ cancel_at: 'fixture' });
    expect(stripe.setToCancel).toHaveBeenCalledWith('org_fixture');
    expect(notifications.sendEmail.mock.calls[0][2]).toContain(body?.feedback?.trim() || 'No feedback provided');
    expect(stripe.setToCancel.mock.invocationCallOrder[0]).toBeLessThan(notifications.sendEmail.mock.invocationCallOrder[0]);
  }
);
