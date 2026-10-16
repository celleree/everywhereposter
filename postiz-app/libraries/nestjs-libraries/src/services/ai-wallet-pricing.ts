import { createHash } from 'crypto';
import { MeasuredUsage } from './ai-wallet-usage';

export const PREPAID_AI_POLICY = { version: '2026-10-16-cost-plus-20-v1', markupPercent: 20,
  topupCents: [500, 1000, 2500], trialGrantNanos: '0' } as const;
export type PricingQuote = {
  policyVersion: string; rateVersion: string; provider: string; model: string;
  currency: 'usd'; markupPercent: 20; requestFingerprint: string;
  per: string; rates: Record<string, string>; limits: Record<string, string>;
};
export type UsageSnapshot = { provider: string; model: string; providerRequestId: string; units: Record<string, string> };
const MAX = 9223372036854775807n;
const integer = (v: unknown, positive = false): bigint => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(v)) throw Error('Invalid pricing integer.');
  const n = BigInt(v);
  if (n > MAX || (positive && n === 0n)) throw Error('Invalid pricing integer.');
  return n;
};
const identity = (v: unknown) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 200) throw Error('Invalid pricing identity.');
};
const keys = (v: unknown): string[] => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid pricing units.');
  const result = Object.keys(v).sort();
  if (!result.length || result.length > 16 || result.some(k => !/^[a-zA-Z][a-zA-Z0-9]{0,49}$/.test(k))) throw Error('Invalid pricing units.');
  return result;
};
/** Canonical hash of validated JSON; never accepts amounts/rates from the client. */
export function snapshotFingerprint(value: unknown): string {
  const canonical = (v: any): any => v && typeof v === 'object'
    ? Array.isArray(v) ? v.map(canonical) : Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validatePricingQuote(raw: unknown): PricingQuote {
  const q = raw as PricingQuote;
  if (!q || q.policyVersion !== PREPAID_AI_POLICY.version || q.markupPercent !== 20 || q.currency !== 'usd' ||
      !/^[a-f0-9]{64}$/.test(q.requestFingerprint || '')) throw Error('Unsupported prepaid pricing policy.');
  [q.rateVersion, q.provider, q.model].forEach(identity);
  integer(q.per, true);
  const categories = keys(q.rates);
  if (categories.join(',') !== keys(q.limits).join(',')) throw Error('Quote limits must cover every tariff category.');
  categories.forEach(k => { integer(q.rates[k]); integer(q.limits[k]); });
  // Reject hidden data, and return an owned JSON copy to prevent later mutation.
  if (Object.keys(q).sort().join(',') !== 'currency,limits,markupPercent,model,per,policyVersion,provider,rateVersion,rates,requestFingerprint') {
    throw Error('Unexpected pricing quote fields.');
  }
  return JSON.parse(JSON.stringify(q));
}
export function usageSnapshot(usage: MeasuredUsage): UsageSnapshot {
  [usage.provider, usage.model, usage.providerRequestId].forEach(identity);
  const categories = keys(usage.units);
  categories.forEach(k => {
    if (typeof usage.units[k] !== 'bigint' || usage.units[k] < 0n || usage.units[k] > MAX) throw Error('Invalid measured usage.');
  });
  return { provider: usage.provider, model: usage.model, providerRequestId: usage.providerRequestId,
    units: Object.fromEntries(categories.map(k => [k, usage.units[k].toString()])) };
}
export function measuredSnapshot(raw: unknown): MeasuredUsage {
  const s = raw as UsageSnapshot;
  if (!s || Object.keys(s).sort().join(',') !== 'model,provider,providerRequestId,units') throw Error('Invalid usage snapshot.');
  [s.provider, s.model, s.providerRequestId].forEach(identity);
  return { ...s, units: Object.fromEntries(keys(s.units).map(k => [k, integer(s.units[k])])) };
}
/** Provider rates must come from an explicitly verified server rate card. The
 * caller supplies hard request bounds, never duration or output-length estimates.
 * One rounding step applies cost +20%; floating-point dollars never enter it. */
export function quotedCharge(raw: unknown, usage?: MeasuredUsage): bigint {
  const q = validatePricingQuote(raw);
  if (usage && (usage.provider !== q.provider || usage.model !== q.model ||
      keys(usage.units).join(',') !== keys(q.rates).join(','))) throw Error('Receipt does not match quoted tariff.');
  if (usage) usageSnapshot(usage);
  const numerator = keys(q.rates).reduce((sum, k) => sum +
    (usage ? usage.units[k] : integer(q.limits[k])) * integer(q.rates[k]), 0n) * 120n;
  const denominator = integer(q.per, true) * 100n;
  const result = (numerator + denominator - 1n) / denominator;
  if (result > MAX || (!usage && result === 0n)) throw Error('Invalid quoted charge.');
  return result;
}
