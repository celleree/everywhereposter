import { createHash } from 'crypto';

// Intentionally test-only. This is not authority to enable live purchases.
export const TOPUP_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const TOPUP_REQUEST_TIMEOUT_MS = 30_000;
export type TopupAccount = { accountId: string; mode: 'test'; returnUrl: string };

export function topupFingerprint(value: unknown): string {
  const canonical = (v: any): any => v && typeof v === 'object'
    ? Array.isArray(v) ? v.map(canonical) : Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function topupBinding(id: string, customerId: string, amountCents: number, account: TopupAccount) {
  if (account.mode !== 'test' || !/^acct_[a-zA-Z0-9]{1,100}$/.test(account.accountId)) throw Error('Invalid test Stripe account.');
  const callback = new URL('/billing', account.returnUrl);
  if (!['http:', 'https:'].includes(callback.protocol) || callback.username || callback.password) throw Error('Invalid Checkout return URL.');
  const request = { mode: 'payment', customer: customerId, client_reference_id: id,
    metadata: { service: 'everywhereposter-ai-wallet-test', topupId: id },
    managed_payments: { enabled: false }, payment_method_types: ['card'], allow_promotion_codes: false,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents,
      product_data: { name: 'Prepaid AI credits (test)' } } }],
    success_url: `${callback.href}?wallet=return`, cancel_url: `${callback.href}?wallet=cancel` };
  return { stripeAccountId: account.accountId, stripeMode: account.mode,
    requestFingerprint: topupFingerprint(request), requestSnapshot: request };
}

export function assertTopupRetryWindow(firstDispatchedAt: Date, now = Date.now()) {
  const first = firstDispatchedAt?.getTime();
  if (!Number.isFinite(first) || first > now || now - first >= TOPUP_RETRY_WINDOW_MS) {
    throw Error('Checkout outcome requires reconciliation; no new session will be created.');
  }
}
