import { Injectable } from '@nestjs/common';
import { AiWalletService } from '../database/prisma/ai-wallet/ai-wallet.service';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
import { PREPAID_AI_POLICY, PricingQuote, quotedCharge, snapshotFingerprint, validatePricingQuote } from './ai-wallet-pricing';
import { normalizeOpenAiTokens } from './ai-wallet-usage';

export const TEXT_INPUT_BYTES = 32768;
export const TEXT_OUTPUT_TOKENS = 4096;
const CONTEXT_TOKENS = '1050000'; // Supported model context windows; deliberately over-reserved.
const models = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.1-terra'];
const enabled = (v?: string) => v?.trim().toLowerCase() === 'true';
const limits = { inputUncachedLow: '272000', inputCachedLow: '272000', outputLow: '4096',
  inputUncachedHigh: CONTEXT_TOKENS, inputCachedHigh: CONTEXT_TOKENS, outputHigh: '4096' };
export type TextRequest = { model: string; reasoning_effort: string;
  messages: { role: string; content: string }[]; response_format: any };

/** Text-only, single completion. Explicit account tariffs cover both input tiers,
 * cached input, reasoning output and the selected processing region. No defaults.
 * Cache-write/tool/media charges without authoritative units are unsupported.
 * Model limits: developers.openai.com/api/docs/models/{gpt-6-luna,gpt-6.1-sol,gpt-6.1-terra}. */
@Injectable()
export class AiWalletTextService {
  constructor(private readonly wallet: AiWalletService) {}

  async run(organizationId: string, operationKey: string, rootFingerprint: string,
    request: TextRequest, allowNew: boolean, invoke: (bounded: any) => Promise<any>) {
    if (!/^guided-text:[a-zA-Z0-9_-]{16,80}:[a-zA-Z0-9_-]{1,60}$/.test(operationKey) ||
        !/^[a-f0-9]{64}$/.test(rootFingerprint) || !models.includes(request.model) ||
        Object.keys(request).sort().join(',') !== 'messages,model,reasoning_effort,response_format' ||
        !Array.isArray(request.messages) || !request.messages.length || request.messages.length > 4 ||
        request.messages.some(m => !['system', 'user'].includes(m.role) || typeof m.content !== 'string' ||
          Object.keys(m).sort().join(',') !== 'content,role') || request.response_format?.type !== 'json_schema' ||
        Buffer.byteLength(JSON.stringify(request), 'utf8') > TEXT_INPUT_BYTES) throw Error('Unsupported or oversized prepaid text request.');
    const bounded = { ...request, max_completion_tokens: TEXT_OUTPUT_TOKENS, n: 1,
      service_tier: 'default', store: false };
    const requestFingerprint = snapshotFingerprint({ organizationId, rootFingerprint, request: bounded });
    let reservation = await this.wallet.quotedOperation(organizationId, operationKey);
    let quote: PricingQuote;
    if (reservation) {
      quote = validatePricingQuote(reservation.quoteSnapshot);
      if (quote.requestFingerprint !== requestFingerprint || quote.model !== request.model || quote.provider !== 'openai') {
        throw Error('Text operation was reused with different inputs.');
      }
      if (reservation.usageSnapshot) return this.wallet.finishText(organizationId, reservation.id);
      if (reservation.state !== 'RESERVED') throw Error('Text dispatch is pending reconciliation; it will not be retried.');
    } else {
      if (!allowNew || !isBillingEnabled() || !enabled(process.env.AI_WALLET_ENABLED) ||
          !enabled(process.env.AI_WALLET_TEXT_ENABLED)) throw Error('Prepaid text generation is disabled.');
      let card: any;
      try { card = JSON.parse(process.env.AI_WALLET_TEXT_RATE_CARDS || '')[request.model]; }
      catch { throw Error('A verified text rate card is required.'); }
      if (!card || Object.keys(card).sort().join(',') !== 'billingContext,per,rateVersion,rates' ||
          card.billingContext !== 'standard-text-receipt-no-extra-charges') throw Error('Unsupported text billing context.');
      quote = validatePricingQuote({ policyVersion: PREPAID_AI_POLICY.version, rateVersion: card.rateVersion,
        provider: 'openai', model: request.model, currency: 'usd', markupPercent: 20, requestFingerprint,
        per: card.per, rates: card.rates, limits });
      reservation = await this.wallet.reserve(organizationId, operationKey, 'openai', request.model, quotedCharge(quote), quote);
    }
    // A reserved hold is not a paid dispatch. Replays may settle incurred work,
    // but cannot start fresh execution after entitlement or flags are revoked.
    if (!allowNew || !isBillingEnabled() || !enabled(process.env.AI_WALLET_ENABLED) ||
        !enabled(process.env.AI_WALLET_TEXT_ENABLED)) throw Error('Prepaid text generation is disabled.');
    const claim = await this.wallet.dispatch(organizationId, reservation.id, true);
    if (!claim.dispatch) {
      if (claim.reservation.usageSnapshot) return this.wallet.finishText(organizationId, reservation.id);
      throw Error('Text dispatch is pending reconciliation; it will not be retried.');
    }
    let requestId: string | undefined;
    try {
      const response = await invoke(bounded);
      requestId = response?.id;
      if (requestId) await this.wallet.markUnknown(organizationId, reservation.id, requestId);
      const measured = normalizeOpenAiTokens('chat', response);
      if (response.service_tier !== 'default' || response.model !== request.model ||
          response.choices[0]?.message?.tool_calls?.length || response.choices[0]?.message?.audio ||
          response.usage.prompt_tokens > Number(CONTEXT_TOKENS) || response.usage.completion_tokens > TEXT_OUTPUT_TOKENS ||
          Object.keys(response.usage.prompt_tokens_details).some(k => !['cached_tokens', 'audio_tokens'].includes(k)) ||
          Object.keys(response.usage.completion_tokens_details || {}).some(k => !['reasoning_tokens', 'audio_tokens',
            'accepted_prediction_tokens', 'rejected_prediction_tokens'].includes(k))) throw Error('Unsupported prepaid text receipt.');
      const tier = response.usage.prompt_tokens > 272000 ? 'High' : 'Low';
      const units = Object.fromEntries(Object.keys(limits).map(k => [k, 0n]));
      for (const [k, n] of Object.entries(measured.units)) units[k + tier] = n;
      const output = { choices: [{ message: { parsed: response.choices[0].message.parsed ?? null } }] };
      if (Buffer.byteLength(JSON.stringify(output)) > 131072) throw Error('Oversized text result.');
      await this.wallet.stageText(organizationId, reservation.id, output, { ...measured, units });
    } catch {
      try { await this.wallet.markUnknown(organizationId, reservation.id, requestId); }
      catch { await this.wallet.markUnknown(organizationId, reservation.id); }
      throw Error('Text dispatch is pending reconciliation; it will not be retried.');
    }
    // Local settlement failure resumes from the persisted business result.
    return this.wallet.finishText(organizationId, reservation.id);
  }
}
