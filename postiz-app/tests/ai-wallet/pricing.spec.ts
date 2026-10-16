import { PREPAID_AI_POLICY, PricingQuote, quotedCharge, snapshotFingerprint, usageSnapshot, measuredSnapshot } from '@gitroom/nestjs-libraries/services/ai-wallet-pricing';

export const fixtureQuote = (): PricingQuote => ({ policyVersion: PREPAID_AI_POLICY.version, rateVersion: 'synthetic-v1',
  provider: 'fixture', model: 'model', currency: 'usd', markupPercent: 20, requestFingerprint: 'a'.repeat(64),
  per: '100', rates: { input: '10', output: '20' }, limits: { input: '1000', output: '200' } });
const receipt = { provider: 'fixture', model: 'model', providerRequestId: 'receipt', units: { input: 1n, output: 1n } };
it('encodes approved manual packs, zero trial grant and versioned cost plus 20 percent', () => {
  expect(PREPAID_AI_POLICY.topupCents).toEqual([500, 1000, 2500]);
  expect(PREPAID_AI_POLICY.trialGrantNanos).toBe('0');
  expect(quotedCharge(fixtureQuote())).toBe(168n);
  // 0.3 provider nanos *1.2 rounds once to1, rather than ceil(provider)*1.2=2.
  expect(quotedCharge(fixtureQuote(), receipt)).toBe(1n);
});
it('canonicalizes rates independent of JSON key order and preserves exact integer receipts', () => {
  const q = fixtureQuote();
  expect(snapshotFingerprint(q)).toBe(snapshotFingerprint({ ...q, rates: { output: '20', input: '10' } }));
  expect(measuredSnapshot(usageSnapshot(receipt))).toEqual(receipt);
  expect(JSON.stringify(usageSnapshot(receipt))).not.toContain('content');
});
it.each([{ markupPercent: 0 }, { policyVersion: 'unknown' }, { requestFingerprint: '' }, { per: '0' },
  { rates: { input: '1.2', output: '1' } }, { limits: { input: '1' } }, { per: '01' },
  { rates: { input: '9223372036854775808', output: '0' } }, { hidden: 'unquoted' },
  { rates: { input: '0', output: '0' } }])('rejects invalid or unsupported quote %p', change => {
  expect(() => quotedCharge({ ...fixtureQuote(), ...change })).toThrow();
});
it('rejects unmetered categories, wrong provider/model, negative usage and overflow', () => {
  for (const u of [{ ...receipt, provider: 'other' }, { ...receipt, model: 'other' },
    { ...receipt, units: { input: 1n } }, { ...receipt, units: { input: -1n, output: 0n } }]) {
    expect(() => quotedCharge(fixtureQuote(), u)).toThrow();
  }
  expect(() => quotedCharge({ ...fixtureQuote(), per: '1', rates: { input: '9223372036854775807', output: '1' } })).toThrow();
});
