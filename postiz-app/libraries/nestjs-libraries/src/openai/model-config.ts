import { PREPAID_AI_POLICY, quotedCharge } from '../services/ai-wallet-pricing';

export const LUNA_CHAT = { model: 'gpt-6-luna', reasoning_effort: 'none' } as const;
export const SOL_CHAT = { model: 'gpt-6.1-sol', reasoning_effort: 'medium' } as const;
export const TERRA_CHAT = { model: 'gpt-6.1-terra', reasoning_effort: 'medium' } as const;

// Only new guided caption drafts/rewrites use this preference. Enablement is
// an operator assertion of verified account access, not a provider probe.
export function customerCopyChat() {
  if (process.env.AI_COPY_TERRA_ENABLED?.trim().toLowerCase() !== 'true') return SOL_CHAT;
  try {
    const card = JSON.parse(process.env.AI_WALLET_TEXT_RATE_CARDS || '')[TERRA_CHAT.model];
    if (!card || Object.keys(card).sort().join(',') !== 'billingContext,per,rateVersion,rates' ||
        card.billingContext !== 'standard-text-receipt-no-extra-charges') return SOL_CHAT;
    const categories = ['inputUncachedLow', 'inputCachedLow', 'outputLow', 'inputUncachedHigh', 'inputCachedHigh', 'outputHigh'];
    if (Object.keys(card.rates || {}).sort().join(',') !== categories.sort().join(',')) return SOL_CHAT;
    quotedCharge({ policyVersion: PREPAID_AI_POLICY.version, rateVersion: card.rateVersion,
      provider: 'openai', model: TERRA_CHAT.model, currency: 'usd', markupPercent: 20,
      requestFingerprint: '0'.repeat(64), per: card.per, rates: card.rates,
      limits: Object.fromEntries(categories.map(key => [key, '1'])) });
    return TERRA_CHAT;
  } catch { return SOL_CHAT; }
}

export function persistedTextChat(model: string) {
  const config = [LUNA_CHAT, SOL_CHAT, TERRA_CHAT].find(candidate => candidate.model === model);
  if (!config) throw Error('Unsupported persisted text model.');
  return config;
}
