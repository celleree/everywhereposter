import { checkoutDisclosure } from '../../apps/frontend/src/components/billing/checkout-disclosure';

const money = (amount: string, minorUnitsAmount: number) => ({ amount, minorUnitsAmount });
const session = (): any => ({
  total: { total: money('$0.00', 0) },
  recurring: { interval: 'month', intervalCount: 1, trial: { trialEnd: 2000000000 },
    dueNext: { subtotal: money('$9.00', 900), total: money('$4.50', 450) } },
});
const now = 1900000000000;

it('keeps the undiscounted base separate from a discounted next charge and actual zero today', () => {
  expect(checkoutDisclosure(session(), now)).toEqual({
    baseAmount: '$9.00', nextAmount: '$4.50', dueToday: '$0.00',
    cadence: 'per month', trialEnd: 2000000000,
  });
});

it.each([['year', 1, 'per year'], ['month', 3, 'every 3 months'],
  ['week', 2, 'every 2 weeks'], ['day', 1, 'per day']])('uses the actual %s interval and count', (interval, count, cadence) => {
  const value = session();
  value.recurring = { ...value.recurring, interval, intervalCount: count, trial: null };
  expect(checkoutDisclosure(value, now)).toMatchObject({ cadence, trialEnd: null });
});

it.each([
  (value: any) => { delete value.total.total; },
  (value: any) => { delete value.recurring.dueNext.total; },
  (value: any) => { delete value.recurring.dueNext.subtotal; },
  (value: any) => { value.recurring.interval = 'unknown'; },
  (value: any) => { delete value.recurring.intervalCount; },
  (value: any) => { value.recurring.intervalCount = 0; },
  (value: any) => { value.recurring.dueNext.total.amount = ''; },
  (value: any) => { value.recurring.dueNext.total.minorUnitsAmount = NaN; },
  (value: any) => { delete value.recurring.trial; },
  (value: any) => { value.recurring.trial.trialEnd = 1800000000; },
  (value: any) => { value.recurring.trial.trialEnd = Infinity; },
  (value: any) => { delete value.recurring.trial.trialEnd; },
  (value: any) => { value.recurring = null; },
])('fails closed for missing or invalid billing metadata (#%#)', (mutate) => {
  const value = session(); mutate(value);
  expect(checkoutDisclosure(value, now)).toBeNull();
});
