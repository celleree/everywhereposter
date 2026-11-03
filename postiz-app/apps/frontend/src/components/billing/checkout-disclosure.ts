import type { StripeCheckoutSession } from '@stripe/stripe-js';

export const BILLING_TERMS_URL = 'https://everywhereposter.com/terms/';

// Use Stripe's formatted amounts; never reconstruct money from a plan or unit price.
export function checkoutDisclosure(
  checkout: Pick<StripeCheckoutSession, 'recurring' | 'total'>,
  now = Date.now()
) {
  const amount = (value: { amount: string; minorUnitsAmount: number } | undefined) =>
    value && Number.isSafeInteger(value.minorUnitsAmount) &&
    value.minorUnitsAmount >= 0 && typeof value.amount === 'string' &&
    value.amount.trim() ? value.amount : null;
  const recurring = checkout?.recurring;
  const interval = recurring?.interval;
  const count = recurring?.intervalCount;
  if (!recurring || !['day', 'week', 'month', 'year'].includes(interval) ||
      !Number.isSafeInteger(count) || count < 1) return null;

  const baseAmount = amount(recurring.dueNext?.subtotal);
  const nextAmount = amount(recurring.dueNext?.total);
  const dueToday = amount(checkout.total?.total);
  if (!baseAmount || !nextAmount || !dueToday) return null;

  const trial = recurring.trial;
  if (trial !== null && (!trial || !Number.isSafeInteger(trial.trialEnd) ||
      trial.trialEnd * 1000 <= now ||
      !Number.isFinite(new Date(trial.trialEnd * 1000).getTime()))) return null;

  return {
    baseAmount,
    nextAmount,
    dueToday,
    cadence: count === 1 ? `per ${interval}` : `every ${count} ${interval}s`,
    trialEnd: trial?.trialEnd ?? null,
  };
}
