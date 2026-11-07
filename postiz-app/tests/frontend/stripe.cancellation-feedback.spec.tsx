import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Info } from '../../apps/frontend/src/components/billing/main.billing.component';
import { BillingController } from '../../apps/backend/src/api/routes/billing.controller';
jest.mock('@prisma/client', () => ({}));

jest.mock('@gitroom/react/form/slider', () => ({ Slider: () => null }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: jest.fn() }));
jest.mock('@gitroom/frontend/components/layout/loading', () => () => null);
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({ deleteDialog: jest.fn() }));
jest.mock('@gitroom/react/toaster/toaster', () => ({ useToaster: jest.fn() }));
jest.mock('@gitroom/frontend/components/billing/faq.component', () => ({ FAQComponent: () => null }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: jest.fn() }));
jest.mock('@gitroom/react/helpers/variable.context', () => ({ useVariables: jest.fn() }));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({ useModals: () => ({ closeAll: jest.fn() }) }));
jest.mock('@gitroom/react/form/textarea', () => ({ Textarea: ({ label, disableForm, ...props }: any) => <label>{label}<textarea {...props} /></label> }));
jest.mock('@gitroom/helpers/utils/use.fire.events', () => ({ useFireEvents: () => jest.fn() }));
jest.mock('@gitroom/helpers/utils/utm.saver', () => ({ useUtmUrl: jest.fn() }));
jest.mock('@gitroom/react/helpers/use.track', () => ({ useTrack: jest.fn() }));
jest.mock('@gitroom/frontend/components/billing/purchase.crypto', () => ({ PurchaseCrypto: () => null }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_: string, fallback: string) => fallback }));
jest.mock('@gitroom/frontend/components/billing/finish.trial', () => ({ FinishTrial: () => null }));
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({ newDayjs: jest.fn() }));
jest.mock('@gitroom/frontend/components/layout/dubAnalytics', () => ({ useDubClickId: jest.fn() }));
jest.mock('@gitroom/frontend/components/layout/logout.component', () => ({ LogoutComponent: () => null }));
jest.mock('@gitroom/nestjs-libraries/services/stripe.service', () => ({ StripeService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/ai-wallet-checkout.service', () => ({ AiWalletCheckoutService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/ai-wallet-refund-request.service', () => ({ AiWalletRefundRequestService: class {} }));
jest.mock('@gitroom/nestjs-libraries/crypto/nowpayments', () => ({ Nowpayments: class {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: class {} }));

const previous = process.env.BILLING_ENABLED;
beforeEach(() => { process.env.BILLING_ENABLED = 'true'; });
afterEach(cleanup);
afterAll(() => { if (previous === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = previous; });

it.each(['', 'short'])('submits optional feedback %p from the rendered UI through cancellation', async (feedback) => {
  const stripe = { setToCancel: jest.fn().mockResolvedValue({ cancel_at: 'fixture' }) };
  const controller = new BillingController({} as any, stripe as any, { sendEmail: jest.fn() } as any, {} as any, {} as any, {} as any);
  const proceed = jest.fn((value: string) => controller.cancel(
    { id: 'org_fixture', users: [{ role: 'ADMIN' }] } as any,
    { email: 'fixture@example.test' } as any, { feedback: value }));
  render(<Info proceed={proceed} />);
  fireEvent.change(screen.getByLabelText('Feedback (optional)'), { target: { value: feedback } });
  const button = screen.getByRole('button', { name: 'Cancel Subscription' });
  expect(button).not.toBeDisabled();
  fireEvent.click(button);
  await waitFor(() => expect(stripe.setToCancel).toHaveBeenCalledWith('org_fixture'));
  expect(proceed).toHaveBeenCalledWith(feedback);
});
