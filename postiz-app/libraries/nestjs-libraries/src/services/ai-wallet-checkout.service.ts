import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';

export const AI_WALLET_TEST_SERVICE = 'everywhereposter-ai-wallet-test';
type Offer = { id: string; amountCents: number };

/** Test-mode adapter only. No default offers or live Stripe account is accepted. */
@Injectable()
export class AiWalletCheckoutService {
  constructor(private readonly db: PrismaService, private readonly wallet: AiWalletService) {}

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

  protected client() { this.assertTestAccount(); return new Stripe(process.env.STRIPE_SECRET_KEY!); }

  offers(): Offer[] {
    this.assertPurchasesEnabled();
    let values: unknown;
    try { values = JSON.parse(process.env.AI_WALLET_TEST_OFFERS || '[]'); }
    catch { throw new ServiceUnavailableException('Invalid test top-up catalogue.'); }
    if (!Array.isArray(values) || values.some((v) => !v || typeof v.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(v.id) || !Number.isSafeInteger(v.amountCents) ||
        v.amountCents < 1 || v.amountCents > 2147483647) ||
        new Set(values.map((v) => v.id)).size !== values.length) {
      throw new ServiceUnavailableException('Invalid test top-up catalogue.');
    }
    return values.map(({ id, amountCents }) => ({ id, amountCents }));
  }

  async balance(organizationId: string) {
    this.assertTestAccount();
    const [balance, entries, operations] = await this.db.$transaction([
      this.db.aiWallet.findUnique({ where: { organizationId } }),
      this.db.aiWalletLedger.findMany({ where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20, select: { id: true, kind: true, amountNanos: true, createdAt: true } }),
      this.db.aiWalletReservation.findMany({ where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20, select: { id: true, provider: true, model: true, state: true, ceilingNanos: true, chargedNanos: true, createdAt: true } }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { organizationId, currency: 'usd', status: balance?.status || 'ACTIVE',
      balanceNanos: (balance?.balanceNanos || 0n).toString(), heldNanos: (balance?.heldNanos || 0n).toString(),
      availableNanos: ((balance?.balanceNanos || 0n) - (balance?.heldNanos || 0n)).toString(),
      entries: entries.map(({ amountNanos, ...entry }) => ({ ...entry, amountNanos: amountNanos.toString() })),
      operations: operations.map(({ ceilingNanos, chargedNanos, ...operation }) => ({ ...operation,
        ceilingNanos: ceilingNanos.toString(), chargedNanos: chargedNanos?.toString() ?? null })) };
  }

  private async customer(organizationId: string) {
    const org = await this.db.organization.findUnique({ where: { id: organizationId }, select: { paymentId: true } });
    if (!org) throw new BadRequestException('Organization not found.');
    if (org.paymentId) return org.paymentId;
    const customer = await this.client().customers.create({ metadata: { organizationId } },
      { idempotencyKey: `ai-wallet-test-customer:${organizationId}` });
    if (customer.livemode !== false) throw new Error('Live billing customer is not supported.');
    await this.db.organization.updateMany({ where: { id: organizationId, paymentId: org.paymentId }, data: { paymentId: customer.id } });
    const saved = await this.db.organization.findUnique({ where: { id: organizationId }, select: { paymentId: true } });
    if (!saved?.paymentId) throw new Error('Billing customer binding failed.');
    return saved.paymentId;
  }

  async createCheckout(organizationId: string, offerId: string, operationKey: string) {
    this.assertPurchasesEnabled();
    if (typeof operationKey !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(operationKey)) {
      throw new BadRequestException('Invalid top-up operation key.');
    }
    const offer = this.offers().find((value) => value.id === offerId);
    if (!offer) throw new BadRequestException('Select a configured test top-up.');
    const customerId = await this.customer(organizationId);
    const intent = await this.wallet.createTopup(organizationId, operationKey, customerId, offer.amountCents);
    if (intent.fundedAt) return { topupId: intent.id, status: 'funded', url: null };
    const callback = new URL('/billing', process.env.FRONTEND_URL);
    if (!['http:', 'https:'].includes(callback.protocol)) throw new ServiceUnavailableException('Invalid Checkout return URL.');
    const session = intent.sessionId
      ? await this.client().checkout.sessions.retrieve(intent.sessionId)
      : await this.client().checkout.sessions.create({ mode: 'payment', customer: intent.customerId,
          client_reference_id: intent.id, metadata: { service: AI_WALLET_TEST_SERVICE, topupId: intent.id },
          payment_method_types: ['card'], allow_promotion_codes: false,
          line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: intent.amountCents,
            product_data: { name: 'Prepaid AI credits (test)' } } }],
          success_url: `${callback.href}?wallet=return`, cancel_url: `${callback.href}?wallet=cancel`,
        }, { idempotencyKey: `ai-wallet-topup:${intent.id}` });
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
    this.assertTestAccount();
    if (event.livemode !== false) throw new BadRequestException('Live wallet events are not supported.');
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed'].includes(event.type)) return { ok: true };
    const session = event.data.object as Stripe.Checkout.Session;
    const intent = await this.db.aiWalletTopup.findUnique({ where: { sessionId: session.id } });
    if (!intent) throw new ServiceUnavailableException('Top-up session is not yet bound.');
    if (session.livemode !== false || session.metadata?.service !== AI_WALLET_TEST_SERVICE ||
        session.metadata?.topupId !== intent.id || session.client_reference_id !== intent.id ||
        session.mode !== 'payment' || session.customer !== intent.customerId ||
        !Number.isSafeInteger(session.amount_total) || session.amount_total! <= 0 ||
        !['paid', 'unpaid'].includes(session.payment_status)) throw new BadRequestException('Invalid wallet Checkout event.');
    const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
    await this.wallet.applyVerifiedTopupEvent({ eventId: event.id, organizationId: intent.organizationId,
      topupId: intent.id, sessionId: session.id, paymentId, customerId: intent.customerId,
      amountCents: session.amount_total!, currency: session.currency?.toLowerCase() || '', mode: 'payment',
      paymentStatus: session.payment_status as 'paid' | 'unpaid' });
    return { ok: true };
  }
}
