import { AsyncLocalStorage } from 'async_hooks';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { SubscriptionRepository } from '../database/prisma/subscriptions/subscription.repository';
import { AiWalletService } from '../database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletTextService, TextRequest } from './ai-wallet-text.service';
import { snapshotFingerprint, validatePricingQuote } from './ai-wallet-pricing';
import { persistedTextChat } from '../openai/model-config';
import { GenerateMediaCopyDto } from '../dtos/copy-generation/generate.media.copy.dto';
import { pricing } from '../database/prisma/subscriptions/pricing';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
type Context = { organizationId: string; requestKey: string; fingerprint: string; counts: Map<string, number> };
const enabled = (v?: string) => v?.trim().toLowerCase() === 'true';

/** Scoped per iterator advance: async generators execute on next(), not creation.
 * Concurrent organizations never share stage counters or accounting identity. */
@Injectable()
export class PrepaidCopyContextService {
  private readonly storage = new AsyncLocalStorage<Context>();
  constructor(private readonly subscriptions: SubscriptionRepository, private readonly wallet: AiWalletService,
    private readonly text: AiWalletTextService) {}
  get active() { return !!this.storage.getStore(); }

  async *scope<T>(organizationId: string, body: GenerateMediaCopyDto, create: () => AsyncGenerator<T>): AsyncGenerator<T> {
    const subscription = await this.subscriptions.getSubscriptionByOrganizationId(organizationId);
    const existing = body.requestKey && await this.wallet.existingTextRequest(organizationId, body.requestKey);
    const launch = subscription?.subscriptionTier === 'LAUNCH_V1';
    if (!launch && !existing) {
      if (isBillingEnabled() && !pricing[subscription?.subscriptionTier || 'FREE'].ai) throw new ForbiddenException('AI is unavailable for this plan.');
      yield* create(); return;
    }
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestKey || '')) throw new ForbiddenException('A stable text request key is required.');
    if (!existing && (!isBillingEnabled() || !enabled(process.env.AI_WALLET_ENABLED) || !enabled(process.env.AI_WALLET_TEXT_ENABLED))) {
      throw new ForbiddenException('Prepaid text generation is disabled.');
    }
    const context: Context = { organizationId, requestKey: body.requestKey!, fingerprint: snapshotFingerprint(body), counts: new Map() };
    const iterator = create();
    try {
      while (true) {
        const step = await this.storage.run(context, () => iterator.next());
        if (step.done) return;
        yield step.value;
      }
    } finally { await this.storage.run(context, () => iterator.return(undefined)); }
  }

  async complete(stage: 'summary' | 'draft' | 'rewrite', request: TextRequest, invoke: (bounded: any) => Promise<any>) {
    const context = this.storage.getStore();
    if (!context) throw Error('A prepaid text context is required.');
    const index = context.counts.get(stage) || 0; context.counts.set(stage, index + 1);
    const operationKey = `guided-text:${context.requestKey}:${stage}_${index}`;
    // Default/config changes must not alter an existing paid operation. The
    // adapter still verifies the full request fingerprint and immutable quote.
    const existing = await this.wallet.quotedOperation(context.organizationId, operationKey);
    if (existing) {
      const quote = validatePricingQuote(existing.quoteSnapshot);
      request = { ...request, ...persistedTextChat(quote.model) };
    }
    const subscription = await this.subscriptions.getSubscriptionByOrganizationId(context.organizationId);
    return this.text.run(context.organizationId, operationKey, context.fingerprint,
      request, subscription?.subscriptionTier === 'LAUNCH_V1', invoke);
  }
}
