import { Injectable } from '@nestjs/common';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';
import { PREPAID_AI_POLICY, PricingQuote, quotedCharge, snapshotFingerprint, validatePricingQuote } from './ai-wallet-pricing';
import { normalizeOpenAiMedia } from './ai-wallet-usage';
export const PREPAID_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const enabled = (v?: string) => v?.trim().toLowerCase() === 'true';

/** One single-block call: no automatic SDK retry, fallback model or duration
 * estimate. Full published model maxima over-reserve both input categories.
 * Rates require an explicitly verified server card; no public-price defaults.
 * Bounds: https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe
 * Single-block default: https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create */
@Injectable()
export class AiWalletTranscriptionService {
  constructor(private readonly wallet: AiWalletService, private readonly model: CopyGenerationModelService) {}

  async run(organizationId: string, transcriptionId: string, generation: number,
    prepare: () => ReturnType<CopyGenerationModelService['preparePrepaidTranscription']>) {
    const key = `media-transcription:${transcriptionId}`;
    const existing = await this.wallet.quotedOperation(organizationId, key);
    // Existing bookkeeping always wins over flags: disabling billing must never
    // route a retry of a paid dispatch through the unmetered legacy path.
    if (existing?.usageSnapshot || existing?.state === 'SETTLED') {
      return this.wallet.finishTranscription(organizationId, existing.id, transcriptionId, generation);
    }
    if (existing && existing.state !== 'RESERVED') return existing;
    if (!enabled(process.env.AI_WALLET_ENABLED)) {
      if (existing) throw Error('Prepaid transcription is paused.');
      return undefined;
    }
    if (!isBillingEnabled() || !enabled(process.env.AI_WALLET_TRANSCRIPTION_ENABLED)) {
      throw Error('Prepaid transcription adapter is disabled.');
    }
    let card: any;
    try { card = JSON.parse(process.env.AI_WALLET_TRANSCRIPTION_RATE_CARD || ''); }
    catch { throw Error('A verified transcription rate card is required.'); }
    if (!card || Object.keys(card).sort().join(',') !== 'per,rateVersion,rates') throw Error('Invalid transcription rate card.');
    const base = { policyVersion: PREPAID_AI_POLICY.version, provider: 'openai', model: PREPAID_TRANSCRIPTION_MODEL,
      currency: 'usd' as const, markupPercent: 20 as const, requestFingerprint: '0'.repeat(64),
      rateVersion: card.rateVersion, per: card.per, rates: card.rates,
      limits: { inputText: '16000', inputAudio: '16000', outputText: '2000' } };
    validatePricingQuote(base); quotedCharge(base); // Validate configuration before local preparation or reservation.
    const prepared = await prepare();
    if (!/^[a-f0-9]{64}$/.test(prepared.audioSha256)) throw Error('Prepared transcription has no audio fingerprint.');
    const quote: PricingQuote = { ...base, requestFingerprint: snapshotFingerprint({ organizationId,
      transcriptionId, generation, model: PREPAID_TRANSCRIPTION_MODEL, audioSha256: prepared.audioSha256 }) };
    const reservation = await this.wallet.reserve(organizationId, key, quote.provider, quote.model, quotedCharge(quote), quote);
    const claim = await this.wallet.dispatchTranscription(organizationId, reservation.id, transcriptionId, generation);
    if (!claim.dispatch) return claim.reservation;
    let requestId: string | undefined;
    try {
      const response = await this.model.transcribePrepaidAudio(prepared.file);
      requestId = response.request_id ?? undefined;
      if (requestId) await this.wallet.markUnknown(organizationId, reservation.id, requestId);
      const receipt = normalizeOpenAiMedia('transcription', response.data, quote.model, requestId!);
      await this.wallet.stageTranscription(organizationId, reservation.id, transcriptionId, generation,
        response.data.text.trim(), receipt);
    } catch {
      // After a claim, ambiguity never releases a hold or triggers a provider retry.
      try { return await this.wallet.markUnknown(organizationId, reservation.id, requestId); }
      catch { return this.wallet.markUnknown(organizationId, reservation.id); }
    }
    // Settlement failure propagates: Temporal may retry this local transaction,
    // and the staged receipt makes that retry skip provider dispatch entirely.
    return this.wallet.finishTranscription(organizationId, reservation.id, transcriptionId, generation);
  }
}
