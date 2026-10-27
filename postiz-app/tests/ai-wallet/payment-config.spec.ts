import { assertTopupRetryWindow, topupBinding, topupFingerprint, TOPUP_RETRY_WINDOW_MS } from '../../libraries/nestjs-libraries/src/services/ai-wallet-payment-config';

describe('test-only durable top-up request identity', () => {
  const account = { accountId: 'acct_fixture', mode: 'test' as const, returnUrl: 'http://localhost:4200' };
  it('preserves the direct-merchant amount, customer, mode and stable metadata', () => {
    const value = topupBinding('topup', 'cus_fixture', 500, account);
    expect(value).toMatchObject({ stripeMode: 'test', stripeAccountId: 'acct_fixture',
      requestSnapshot: { mode: 'payment', customer: 'cus_fixture', managed_payments: { enabled: false },
        metadata: { topupId: 'topup', service: 'everywhereposter-ai-wallet-test' },
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 500 } }] } });
    expect(value.requestFingerprint).toBe(topupFingerprint(value.requestSnapshot));
  });
  it('hashes reordered object keys identically and binds changed amounts', () => {
    expect(topupFingerprint({ a: 1, b: { c: 2 } })).toBe(topupFingerprint({ b: { c: 2 }, a: 1 }));
    expect(topupBinding('id', 'cus_fixture', 500, account).requestFingerprint)
      .not.toBe(topupBinding('id', 'cus_fixture', 1000, account).requestFingerprint);
  });
  it.each([{ ...account, mode: 'live' }, { ...account, accountId: 'other' },
    { ...account, returnUrl: 'file:///tmp/private' }, { ...account, returnUrl: 'https://user:password@example.com' }])(
    'rejects unsupported account/return configuration', value => expect(() => topupBinding('id', 'cus_fixture', 500, value as any)).toThrow());
  it('allows only the original bounded dispatch window, never renewing it', () => {
    const now = Date.now();
    expect(() => assertTopupRetryWindow(new Date(now - TOPUP_RETRY_WINDOW_MS + 1), now)).not.toThrow();
    expect(() => assertTopupRetryWindow(new Date(now - TOPUP_RETRY_WINDOW_MS), now)).toThrow('reconciliation');
    expect(() => assertTopupRetryWindow(new Date(now + 1), now)).toThrow('reconciliation');
    expect(() => assertTopupRetryWindow(new Date(NaN), now)).toThrow('reconciliation');
  });
});
