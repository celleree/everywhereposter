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
    allowNewReservation: boolean,
    prepare: () => ReturnType<CopyGenerationModelService['preparePrepaidTranscription']>) {
    const key = `media-transcription:${transcriptionId}`;
    const existing = await this.wallet.quotedOperation(organizationId, key);
    // Existing bookkeeping always wins over flags: disabling billing must never
    // route a retry of a paid dispatch through the unmetered legacy path.
    if (existing?.usageSnapshot || existing?.state === 'SETTLED') {
      return this.wallet.finishTranscription(organizationId, existing.id, transcriptionId, generation);
    }
    if (existing && existing.state !== 'RESERVED') return existing;
    // A legacy bundled-AI plan without prepaid work keeps its existing path.
    if (!existing && !allowNewReservation) return undefined;
    // A hold is not execution authority. Incurred work returned above may settle
    // after revocation, but every undispatched operation needs a current grant.
    if (!allowNewReservation || !enabled(process.env.AI_WALLET_ENABLED) || !isBillingEnabled() ||
        !enabled(process.env.AI_WALLET_TRANSCRIPTION_ENABLED)) {
      throw Error('Prepaid transcription adapter is disabled.');
    }

    let quote: PricingQuote;
    let reservation: any;
    let resumeExisting = false;
    if (existing) {
      // An accepted reservation owns an immutable quote. Revalidating that
      // snapshot and its input fingerprint lets authorized held work resume
      // without accepting current environment pricing.
      quote = validatePricingQuote(existing.quoteSnapshot);
      if (quote.provider !== 'openai' || quote.model !== PREPAID_TRANSCRIPTION_MODEL) {
        throw Error('Reservation does not match prepaid transcription.');
      }
      reservation = existing;
      resumeExisting = true;
    } else {
      let card: any;
      try { card = JSON.parse(process.env.AI_WALLET_TRANSCRIPTION_RATE_CARD || ''); }
      catch { throw Error('A verified transcription rate card is required.'); }
      if (!card || Object.keys(card).sort().join(',') !== 'per,rateVersion,rates') throw Error('Invalid transcription rate card.');
      quote = { policyVersion: PREPAID_AI_POLICY.version, provider: 'openai', model: PREPAID_TRANSCRIPTION_MODEL,
        currency: 'usd' as const, markupPercent: 20 as const, requestFingerprint: '0'.repeat(64),
        rateVersion: card.rateVersion, per: card.per, rates: card.rates,
        limits: { inputText: '16000', inputAudio: '16000', outputText: '2000' } };
      validatePricingQuote(quote); quotedCharge(quote); // Validate configuration before local preparation or reservation.
    }
    const prepared = await prepare();
    if (!/^[a-f0-9]{64}$/.test(prepared.audioSha256)) throw Error('Prepared transcription has no audio fingerprint.');
    const requestFingerprint = snapshotFingerprint({ organizationId, transcriptionId, generation,
      model: PREPAID_TRANSCRIPTION_MODEL, audioSha256: prepared.audioSha256 });
    if (resumeExisting) {
      if (quote.requestFingerprint !== requestFingerprint) throw Error('Reservation input fingerprint does not match transcription.');
    } else {
      quote = { ...quote, requestFingerprint };
      reservation = await this.wallet.reserve(organizationId, key, quote.provider, quote.model, quotedCharge(quote), quote);
    }
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
