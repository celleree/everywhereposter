import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException, Optional } from '@nestjs/common';
import Stripe from 'stripe';
import { AiWalletRefundRequestService } from './ai-wallet-refund-request.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { PREPAID_AI_POLICY } from './ai-wallet-pricing';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
import { walletHoldSnapshot } from './ai-wallet-holds';
import { assertTopupRetryWindow, TOPUP_REQUEST_TIMEOUT_MS } from './ai-wallet-payment-config';

export const AI_WALLET_TEST_SERVICE = 'everywhereposter-ai-wallet-test';
type Offer = { id: string; amountCents: number };
// Stripe 20.4 serializes this documented field but does not yet declare its type.
type DirectMerchantCheckoutParams = Stripe.Checkout.SessionCreateParams & {
  managed_payments: { enabled: false };
};

/** Test-mode adapter only. Approved manual packs; live Stripe accounts are rejected. */
@Injectable()
export class AiWalletCheckoutService {
  constructor(private readonly db: PrismaService, private readonly wallet: AiWalletService, @Optional() private readonly refunds?: AiWalletRefundRequestService) {}

  async assertPrepaidPlan(organizationId: string) {
    const subscription = await this.db.subscription.findFirst({
      where: { organizationId, deletedAt: null },
      select: { subscriptionTier: true },
    });
    if (String(subscription?.subscriptionTier || '') !== 'LAUNCH_V1') {
      throw new ForbiddenException('Prepaid AI is not included in this plan.');
    }
  }

  private assertTestAccount() {
    if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || '')) {
      throw new ServiceUnavailableException('Prepaid Checkout requires a Stripe test account.');
    }
  }

  private assertPurchasesEnabled() {
    this.assertTestAccount();
    if (!isBillingEnabled() || process.env.AI_WALLET_ENABLED?.trim().toLowerCase() !== 'true') {
      throw new ServiceUnavailableException('Prepaid AI billing is disabled.');
    }
  }

  protected client() { this.assertTestAccount(); return new Stripe(process.env.STRIPE_SECRET_KEY!,
    { maxNetworkRetries: 0, timeout: TOPUP_REQUEST_TIMEOUT_MS }); }

  private async accountId() {
    const account = await this.client().accounts.retrieve();
    if (!/^acct_[a-zA-Z0-9]{1,100}$/.test(account?.id || '')) throw new ServiceUnavailableException('Test Stripe account could not be verified.');
    return account.id;
  }

  private configuredOffers(): Offer[] {
    this.assertPurchasesEnabled();
    let values: unknown;
    try { values = process.env.AI_WALLET_TEST_OFFERS === undefined
      ? PREPAID_AI_POLICY.topupCents.map(amountCents => ({ id: `usd_${amountCents}`, amountCents }))
      : JSON.parse(process.env.AI_WALLET_TEST_OFFERS); }
    catch { throw new ServiceUnavailableException('Invalid test top-up catalogue.'); }
    if (!Array.isArray(values) || values.some((v) => !v || typeof v.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(v.id) || !Number.isSafeInteger(v.amountCents) ||
        v.amountCents < 1 || v.amountCents > 2147483647) ||
        new Set(values.map((v) => v.id)).size !== values.length) {
      throw new ServiceUnavailableException('Invalid test top-up catalogue.');
    }
    return values.map(({ id, amountCents }) => ({ id, amountCents }));
  }

  async offers(organizationId: string): Promise<Offer[]> {
    await this.assertPrepaidPlan(organizationId);
    return this.configuredOffers();
  }

  async balance(organizationId: string) {
    await this.assertPrepaidPlan(organizationId);
    this.assertTestAccount();
    const [holds, entries, operations] = await this.db.$transaction(tx => Promise.all([
      walletHoldSnapshot(tx, organizationId),
      tx.aiWalletLedger.findMany({ where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20, select: { id: true, kind: true, amountNanos: true, createdAt: true } }),
      tx.aiWalletReservation.findMany({ where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20, select: { id: true, provider: true, model: true, state: true, ceilingNanos: true, chargedNanos: true, createdAt: true } }),
    ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const balance = holds.wallet;
    return { organizationId, currency: 'usd', status: holds.reconciled ? balance?.status || 'ACTIVE' : 'REVIEW',
      balanceNanos: (balance?.balanceNanos || 0n).toString(), heldNanos: (balance?.heldNanos || 0n).toString(),
      availableNanos: (holds.reconciled && (!balance || balance.status === 'ACTIVE')
        ? (balance?.balanceNanos || 0n) - (balance?.heldNanos || 0n) : 0n).toString(),
      entries: entries.map(({ amountNanos, ...entry }) => ({ ...entry, amountNanos: amountNanos.toString() })),
      operations: operations.map(({ ceilingNanos, chargedNanos, ...operation }) => ({ ...operation,
        ceilingNanos: ceilingNanos.toString(), chargedNanos: chargedNanos?.toString() ?? null })) };
  }

  private async customer(organizationId: string) {
    const org = await this.db.organization.findUnique({ where: { id: organizationId }, select: { paymentId: true } });
    if (!org) throw new BadRequestException('Organization not found.');
    if (org.paymentId) {
      const saved = await this.client().customers.retrieve(org.paymentId);
      if (saved.deleted || saved.id !== org.paymentId || !('livemode' in saved) || saved.livemode !== false) throw new Error('Test billing customer could not be verified.');
      return org.paymentId;
    }
    await this.assertPrepaidPlan(organizationId);
    const customer = await this.client().customers.create({ metadata: { organizationId } },
      { idempotencyKey: `ai-wallet-test-customer:${organizationId}` });
    if (customer.livemode !== false) throw new Error('Live billing customer is not supported.');
    await this.db.organization.updateMany({ where: { id: organizationId, paymentId: org.paymentId }, data: { paymentId: customer.id } });
    const saved = await this.db.organization.findUnique({ where: { id: organizationId }, select: { paymentId: true } });
    if (!saved?.paymentId) throw new Error('Billing customer binding failed.');
    const bound = await this.client().customers.retrieve(saved.paymentId);
    if (bound.deleted || bound.id !== saved.paymentId || !('livemode' in bound) || bound.livemode !== false) throw new Error('Test billing customer could not be verified.');
    return saved.paymentId;
  }

  async createCheckout(organizationId: string, offerId: string, operationKey: string) {
    await this.assertPrepaidPlan(organizationId);
    this.assertPurchasesEnabled();
    if (typeof operationKey !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(operationKey)) {
      throw new BadRequestException('Invalid top-up operation key.');
    }
    const offer = this.configuredOffers().find((value) => value.id === offerId);
    if (!offer) throw new BadRequestException('Select a configured test top-up.');
    const accountId = await this.accountId();
    const customerId = await this.customer(organizationId);
    const intent = await this.wallet.createTopup(organizationId, operationKey, customerId, offer.amountCents,
      { accountId, mode: 'test', returnUrl: process.env.FRONTEND_URL! });
    if (intent.fundedAt) return { topupId: intent.id, status: 'funded', url: null };
    // Re-read the durable plan immediately before contacting Stripe. The
    // controller/UI decision may have raced a subscription change.
    await this.assertPrepaidPlan(organizationId);
    const attempt = await this.wallet.claimTopupCheckout(organizationId, intent.id, accountId);
    let session: Stripe.Checkout.Session;
    if (attempt.sessionId) session = await this.client().checkout.sessions.retrieve(attempt.sessionId);
    else {
      // Recheck after DB/plan work; never renew this clock after response loss.
      assertTopupRetryWindow(attempt.firstDispatchedAt!);
      session = await this.client().checkout.sessions.create(attempt.requestSnapshot as unknown as DirectMerchantCheckoutParams,
        { idempotencyKey: `ai-wallet-topup:${intent.id}`, maxNetworkRetries: 0, timeout: TOPUP_REQUEST_TIMEOUT_MS });
    }
    if (session.livemode !== false || session.mode !== 'payment' || session.customer !== intent.customerId ||
        session.amount_total !== intent.amountCents || session.currency !== 'usd' ||
        session.client_reference_id !== intent.id || session.metadata?.service !== AI_WALLET_TEST_SERVICE ||
        session.metadata?.topupId !== intent.id) throw new Error('Checkout session does not match the top-up.');
    await this.wallet.bindTopupSession(organizationId, intent.id, session.id);
    if (session.url) {
      const url = new URL(session.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Unexpected Checkout URL.');
    }
    return { topupId: intent.id, status: session.status, url: session.url };
  }

  /** Caller must verify the raw Stripe signature before dispatching here. */
  async handleVerifiedEvent(event: Stripe.Event) {
    if (event.type.startsWith('refund.') || event.type === 'charge.refunded' || event.type.startsWith('charge.dispute.')) {
      if (process.env.AI_WALLET_TEST_REFUNDS_ENABLED?.trim().toLowerCase() !== 'true') return { ok: true };
      if (!this.refunds) throw new ServiceUnavailableException('Refund reconciliation is unavailable.');
      return this.refunds.handleVerifiedRefundEvent(event);
    }
    this.assertTestAccount();
    if (event.livemode !== false || event.account) throw new BadRequestException('Live or Connect wallet events are not supported.');
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed'].includes(event.type)) return { ok: true };
    const session = event.data.object as Stripe.Checkout.Session;
    // Metadata only locates a candidate; all stored monetary/account identities
    // are verified below and again inside the atomic recovery/funding transaction.
    const intent = typeof session.metadata?.topupId === 'string'
      ? await this.db.aiWalletTopup.findUnique({ where: { id: session.metadata.topupId } }) : null;
    if (!intent) throw new ServiceUnavailableException('Top-up session is not yet bound.');
    if (session.livemode !== false || session.metadata?.service !== AI_WALLET_TEST_SERVICE ||
        session.metadata?.topupId !== intent.id || session.client_reference_id !== intent.id ||
        session.mode !== 'payment' || session.customer !== intent.customerId ||
        !Number.isSafeInteger(session.amount_total) || session.amount_total! <= 0 ||
        !['paid', 'unpaid'].includes(session.payment_status)) throw new BadRequestException('Invalid wallet Checkout event.');
    const accountId = await this.accountId();
    const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
    await this.wallet.applyVerifiedTopupEvent({ eventId: event.id, organizationId: intent.organizationId,
      topupId: intent.id, sessionId: session.id, paymentId, customerId: intent.customerId,
      amountCents: session.amount_total!, currency: session.currency?.toLowerCase() || '', mode: 'payment',
      paymentStatus: session.payment_status as 'paid' | 'unpaid', account: { accountId, mode: 'test' } });
    return { ok: true };
  }
}
