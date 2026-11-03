import React from 'react';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { EmbeddedBilling } from '../../apps/frontend/src/components/billing/embedded.billing';

let mockState: any;
let mockPayment: any;
const mockToast = jest.fn();
jest.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutProvider: ({ children }: any) => children,
  useCheckout: () => mockState,
  PaymentElement: (props: any) => { mockPayment = props; return <div data-testid="stripe-payment" />; },
}));
jest.mock('@gitroom/frontend/components/layout/mode.component', () => ({ modeEmitter: { on: jest.fn(), removeAllListeners: jest.fn() } }));
jest.mock('react-use-cookie', () => ({ __esModule: true, default: () => ['dark', jest.fn()] }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_: string, fallback: string) => fallback }));
jest.mock('@gitroom/react/toaster/toaster', () => ({ useToaster: () => ({ show: mockToast }) }));

const amount = (amount: string, minorUnitsAmount: number) => ({ amount, minorUnitsAmount });
const renderCheckout = () => render(<EmbeddedBilling stripe={Promise.resolve({} as any)} secret="cs_fixture" />);
beforeEach(() => {
  mockState = { type: 'success', checkout: { canConfirm: true,
    confirm: jest.fn().mockResolvedValue({ type: 'success' }),
    total: { total: amount('$0.00', 0) },
    recurring: { interval: 'month', intervalCount: 1, trial: { trialEnd: 2000000000 },
      dueNext: { subtotal: amount('$9.00', 900), total: amount('$4.50', 450) } },
  } };
});
afterEach(cleanup);

it('shows loading and provider errors without a confirmation button', () => {
  mockState = { type: 'loading' }; const view = renderCheckout();
  expect(screen.getByRole('status').textContent).toContain('Loading');
  expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull();
  mockState = { type: 'error', error: { message: 'fixture' } }; view.rerender(<EmbeddedBilling stripe={Promise.resolve({} as any)} secret="cs_fixture" />);
  expect(screen.getByRole('alert').textContent).toContain('unavailable');
});

it('waits for payment readiness, shows actual amounts and terms, and confirms once ready', async () => {
  renderCheckout();
  expect(screen.getByRole('status').textContent).toContain('Loading payment form');
  fireEvent.submit(screen.getByTestId('stripe-payment').closest('form')!);
  expect(mockState.checkout.confirm).not.toHaveBeenCalled();
  act(() => mockPayment.onReady());
  expect(screen.getByText(/Base subscription/).textContent).toContain('$9.00 per month');
  expect(screen.getByText(/It then converts/).textContent).toContain('$4.50');
  expect(screen.queryByText(/7-day|100% free|never be charged/i)).toBeNull();
  for (const link of screen.getAllByRole('link', { name: 'Terms of Service' })) expect(link.getAttribute('href')).toBe('https://everywhereposter.com/terms/');
  fireEvent.click(screen.getByRole('button', { name: 'Start trial' }));
  await waitFor(() => expect(mockState.checkout.confirm).toHaveBeenCalledTimes(1));
});

it.each(['amount', 'trial', 'cadence'])('disables confirmation for malformed %s data and payment errors', async (field) => {
  if (field === 'amount') mockState.checkout.recurring.dueNext.total = undefined;
  if (field === 'trial') delete mockState.checkout.recurring.trial;
  if (field === 'cadence') mockState.checkout.recurring.interval = 'unknown';
  renderCheckout();
  act(() => mockPayment.onReady());
  expect(screen.getByRole('alert').textContent).toContain('unavailable');
  expect(screen.getByRole('button', { name: 'Subscribe' })).toBeDisabled();
  fireEvent.submit(screen.getByTestId('stripe-payment').closest('form')!);
  expect(mockState.checkout.confirm).not.toHaveBeenCalled();
  act(() => mockPayment.onLoadError());
  expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull();
});

it('updates disclosed totals when discounts change and honors Stripe confirmation readiness', () => {
  mockState.checkout.recurring.trial = null;
  const view = renderCheckout(); act(() => mockPayment.onReady());
  expect(screen.getByText('Next payment: $4.50.')).toBeTruthy();
  mockState.checkout.recurring.dueNext.total = amount('$9.00', 900);
  mockState.checkout.canConfirm = false;
  view.rerender(<EmbeddedBilling stripe={Promise.resolve({} as any)} secret="cs_fixture" />);
  expect(screen.getByText('Next payment: $9.00.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Subscribe' })).toBeDisabled();
  fireEvent.submit(screen.getByTestId('stripe-payment').closest('form')!);
  expect(mockState.checkout.confirm).not.toHaveBeenCalled();
});

it.each(['thrown', 'returned'])('shows paid renewal without trial claims and recovers from %s confirmation errors', async (failure) => {
  mockState.checkout.recurring.trial = null;
  mockState.checkout.total.total = amount('$4.50', 450);
  if (failure === 'thrown') mockState.checkout.confirm.mockRejectedValue(new Error('offline'));
  else mockState.checkout.confirm.mockResolvedValue({ type: 'error', error: { message: 'Please try again' } });
  renderCheckout();
  act(() => mockPayment.onReady());
  expect(screen.getByText('Next payment: $4.50.')).toBeTruthy();
  expect(screen.queryByText(/Your trial ends/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('try again'), 'warning'));
  expect(screen.getByRole('button', { name: 'Subscribe' })).not.toBeDisabled();
});
