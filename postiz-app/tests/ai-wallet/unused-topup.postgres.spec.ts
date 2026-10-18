import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletRefundRequestService } from '@gitroom/nestjs-libraries/services/ai-wallet-refund-request.service';
import { StripeController } from '../../apps/backend/src/api/routes/stripe.controller';
import { AiWalletCheckoutService } from '@gitroom/nestjs-libraries/services/ai-wallet-checkout.service';

jest.mock('@gitroom/nestjs-libraries/services/stripe.service', () => ({ StripeService: class {} }));
const fixture = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixture ? describe : describe.skip)('test-only fully unused top-up reconciliation', () => {
  let db: PrismaClient, wallet: AiWalletService, service: AiWalletRefundRequestService, org: string, topup: any, request: any;
  let hook: StripeController;
  const signer = new Stripe('sk_test_synthetic_not_a_credential');
  const original = { ...process.env };
  const refundId = () => `re_${topup.id}`, chargeId = () => `ch_${topup.id}`;
  beforeAll(async () => {
    const url = new URL(fixture!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ep_ai_wallet_test') throw Error('Isolated wallet fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixture } } }); await db.$connect();
  });
  beforeEach(async () => {
    Object.assign(process.env, { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true', AI_WALLET_TEST_REFUNDS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_synthetic_not_a_credential', STRIPE_SIGNING_KEY: 'whsec_synthetic_fixture' });
    org = randomUUID(); await db.organization.create({ data: { id: org, name: 'Synthetic unused topup' } });
    wallet = new AiWalletService({ model: db } as any); service = new AiWalletRefundRequestService({ model: db } as any);
    topup = await wallet.createTopup(org, randomUUID(), 'cus_synthetic', 123);
    await wallet.bindTopupSession(org, topup.id, `cs_${topup.id}`);
    await fund(topup); request = await service.request(org, 'requester', randomUUID());
    hook = new StripeController({ validateRequest: (raw: Buffer, signature: string, secret: string) => signer.webhooks.constructEvent(raw, signature, secret) } as any,
      new AiWalletCheckoutService(db as any, wallet, service));
  });
  afterAll(async () => { process.env = original; await db?.$disconnect(); });
  const fund = (t: any) => wallet.applyVerifiedTopupEvent({ eventId: randomUUID(), organizationId: org, topupId: t.id,
    sessionId: `cs_${t.id}`, paymentId: `pi_${t.id}`, customerId: t.customerId, amountCents: t.amountCents, currency: 'usd', mode: 'payment', paymentStatus: 'paid' });
  const approve = (r = request) => service.reviewTestTopup(org, r.id, 'platform-admin', { topupId: topup.id, refundId: refundId(), chargeId: chargeId() });
  const event = (status = 'succeeded', changes: any = {}, type = 'refund.updated') => ({ id: `evt_${randomUUID()}`, object: 'event', livemode: false, type,
    data: { object: { id: refundId(), object: 'refund', payment_intent: `pi_${topup.id}`, charge: chargeId(), amount: 123, currency: 'usd', status, ...changes } } });
  const deliver = (e: any) => { const payload = JSON.stringify(e); return hook.stripe({ rawBody: Buffer.from(payload), headers: {
    'stripe-signature': signer.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_SIGNING_KEY! }) } } as any); };
  const balance = () => db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } });

  it('defaults off and refuses live keys/events before any reconciliation', async () => {
    delete process.env.AI_WALLET_TEST_REFUNDS_ENABLED; await expect(approve()).rejects.toThrow('disabled');
    process.env.AI_WALLET_TEST_REFUNDS_ENABLED = 'true'; process.env.STRIPE_SECRET_KEY = 'sk_live_synthetic';
    await expect(approve()).rejects.toThrow('test account');
    process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_not_a_credential'; await approve();
    await expect(deliver({ ...event(), livemode: true })).rejects.toThrow('Live');
    expect(await balance()).toMatchObject({ balanceNanos: 1230000000n, heldNanos: 1230000000n });
  });
  it('holds one full original purchase and reconciles signed success once across concurrent delivery/restarts', async () => {
    await approve(); await expect(service.resolve(org, request.id, 'u', 'WITHDRAWN')).rejects.toThrow('reconciliation');
    await deliver(event('pending'));
    const e = event(); await Promise.all([deliver(e), deliver(e), deliver(event())]);
    expect(await balance()).toMatchObject({ balanceNanos: 0n, heldNanos: 0n, status: 'ACTIVE' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'REVERSAL' } })).toBe(1);
    expect(await service.summary(org)).toMatchObject({ eligibleNanos: '0', requiresReconciliation: false });
    expect((await service.summary(org)).requests[0].status).toBe('REFUNDED');
    await new AiWalletRefundRequestService({ model: db } as any).handleVerifiedRefundEvent(event()); await fund(topup);
    expect(await balance()).toMatchObject({ balanceNanos: 0n, heldNanos: 0n });
  });
  it.each([['failed'], ['canceled'], ['failed', 'pending'], ['canceled', 'pending']])('retains full holds on terminal contradiction after %j', async (...states) => {
    await approve();
    for (const state of states) await deliver(event(state));
    expect((await service.summary(org)).requests[0].testReconciliation?.state).toBe('FAILED');
    expect(await balance()).toMatchObject({ balanceNanos: 1230000000n, heldNanos: 1230000000n });
    await expect(wallet.reserve(org, randomUUID(), 'fixture', 'offline', 1n)).rejects.toThrow();
    await deliver(event()); await deliver(event('pending'));
    expect(await balance()).toMatchObject({ balanceNanos: 1230000000n, heldNanos: 1230000000n, status: 'REVIEW' });
    expect((await service.summary(org)).requests[0].testReconciliation?.state).toBe('UNCERTAIN');
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'REVERSAL' } })).toBe(0);
  });
  it('keeps a successful debit and REVIEW after later failed evidence without restoring credits', async () => {
    await approve(); await deliver(event()); await deliver(event('failed')); await deliver(event('pending')); await deliver(event());
    expect(await balance()).toMatchObject({ balanceNanos: 0n, heldNanos: 0n, status: 'REVIEW' });
    expect((await service.summary(org)).requests[0].testReconciliation?.state).toBe('UNCERTAIN');
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'REVERSAL' } })).toBe(1);
  });
  it.each([{ amount: 1 }, { currency: 'eur' }, { id: 're_unknown' }, { charge: 'ch_wrong' }, { payment_intent: null }])('retains holds for mismatched signed refund %j', async changes => {
    await approve(); await deliver(event('succeeded', changes));
    expect(await balance()).toMatchObject({ balanceNanos: 1230000000n, heldNanos: 1230000000n, status: 'REVIEW' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'REVERSAL' } })).toBe(0);
  });
  it('retains uncertain provider evidence through later pending and success', async () => {
    await approve(); await deliver(event('requires_action')); await deliver(event('pending')); await deliver(event());
    expect(await balance()).toMatchObject({ balanceNanos: 1230000000n, heldNanos: 1230000000n, status: 'REVIEW' });
    expect((await service.summary(org)).requests[0].testReconciliation?.state).toBe('UNCERTAIN');
  });
  it('refuses mixed funding, new funding races and any reservation history including zero-charge settlement', async () => {
    await service.resolve(org, request.id, 'u', 'WITHDRAWN');
    const r = await wallet.reserve(org, randomUUID(), 'fixture', 'offline', 1n); await wallet.dispatch(org, r.id); await wallet.settle(org, r.id, 0n, randomUUID());
    request = await service.request(org, 'u', randomUUID()); await expect(approve()).rejects.toThrow('unused');
  });
  it('rechecks funding and ledger at success and never consumes new money', async () => {
    await approve(); const other = await wallet.createTopup(org, randomUUID(), 'cus_synthetic', 50);
    await wallet.bindTopupSession(org, other.id, `cs_${other.id}`); await fund(other); await deliver(event());
    expect(await balance()).toMatchObject({ balanceNanos: 1730000000n, heldNanos: 1230000000n, status: 'REVIEW' });
  });
  it('audits unapproved refunds/disputes and isolates subscription events even with forged metadata', async () => {
    await deliver(event('succeeded', { payment_intent: 'pi_subscription', metadata: { topupId: topup.id } }));
    expect((await balance()).status).toBe('ACTIVE');
    await deliver(event('succeeded', {}, 'charge.dispute.created'));
    expect((await balance()).status).toBe('REVIEW'); await expect(approve()).rejects.toThrow('reconciliation');
    expect(await db.aiWalletRefundEvent.count({ where: { organizationId: org } })).toBe(1);
  });
  it('quarantines refunds arriving before Checkout funding without spending or refunding subscription money', async () => {
    const other = await wallet.createTopup(org, randomUUID(), 'cus_synthetic', 50);
    await wallet.bindTopupSession(org, other.id, `cs_${other.id}`);
    await deliver(event('succeeded', { id: 're_early', charge: 'ch_early', payment_intent: `pi_${other.id}`, amount: 50 }));
    expect((await balance()).status).toBe('ACTIVE');
    await fund(other);
    expect(await balance()).toMatchObject({ balanceNanos: 1730000000n, heldNanos: 1230000000n, status: 'REVIEW' });
  });
  it('freezes both wallets when durable payment and reviewed refund identities disagree', async () => {
    await approve(); const firstOrg = org;
    org = randomUUID(); await db.organization.create({ data: { id: org, name: 'Other synthetic org' } });
    const other = await wallet.createTopup(org, randomUUID(), 'cus_other', 123);
    await wallet.bindTopupSession(org, other.id, `cs_${other.id}`); await fund(other);
    await deliver(event('succeeded', { payment_intent: `pi_${other.id}` }));
    expect((await balance()).status).toBe('REVIEW');
    expect(await db.aiWallet.findUniqueOrThrow({ where: { organizationId: firstOrg } })).toMatchObject({ status: 'REVIEW', balanceNanos: 1230000000n, heldNanos: 1230000000n });
  });
  it('protects review identity, event audit and cross-organization association at the database boundary', async () => {
    await expect(service.reviewTestTopup('another-org', request.id, 'admin', { topupId: topup.id, refundId: refundId(), chargeId: chargeId() })).rejects.toThrow('unused');
    await approve(); await deliver(event('pending'));
    await expect(db.aiWalletRefundReconciliation.update({ where: { requestId: request.id }, data: { amountCents: 1 } })).rejects.toThrow('immutable');
    await expect(db.aiWalletRefundReconciliation.delete({ where: { requestId: request.id } })).rejects.toThrow('cannot be deleted');
    const audit = await db.aiWalletRefundEvent.findFirstOrThrow({ where: { organizationId: org } });
    await expect(db.aiWalletRefundEvent.update({ where: { eventId: audit.eventId }, data: { outcome: 'SUCCEEDED' } })).rejects.toThrow('immutable');
    await expect(db.aiWalletRefundEvent.delete({ where: { eventId: audit.eventId } })).rejects.toThrow('cannot be deleted');
  });
  it('serializes review against withdrawal and a new reservation without overlapping value', async () => {
    const result = await Promise.allSettled([approve(), service.resolve(org, request.id, 'u', 'WITHDRAWN'), wallet.reserve(org, randomUUID(), 'fixture', 'offline', 1n)]);
    const reviewed = await db.aiWalletRefundReconciliation.findUnique({ where: { requestId: request.id } });
    if (reviewed) {
      expect(result[0].status).toBe('fulfilled'); expect(result[1].status).toBe('rejected'); expect(result[2].status).toBe('rejected');
      expect(await balance()).toMatchObject({ heldNanos: 1230000000n });
    } else {
      expect(result[0].status).toBe('rejected'); expect(result[1].status).toBe('fulfilled');
    }
  });
  it('retries a funding snapshot taken before orphan quarantine committed', async () => {
    const other = await wallet.createTopup(org, randomUUID(), 'cus_synthetic', 50);
    await wallet.bindTopupSession(org, other.id, `cs_${other.id}`);
    let attempts = 0;
    const stale = new AiWalletService({ model: { $transaction: (fn: any, opts: any) => db.$transaction(async tx => {
      if (++attempts === 1) {
        await tx.aiWalletRefundEvent.count({ where: { paymentId: `pi_${other.id}` } });
        await deliver(event('succeeded', { id: 're_before_funding', charge: 'ch_before_funding', payment_intent: `pi_${other.id}`, amount: 50 }));
      }
      return fn(tx);
    }, opts) } } as any);
    await stale.applyVerifiedTopupEvent({ eventId: randomUUID(), organizationId: org, topupId: other.id,
      sessionId: `cs_${other.id}`, paymentId: `pi_${other.id}`, customerId: 'cus_synthetic', amountCents: 50, currency: 'usd', mode: 'payment', paymentStatus: 'paid' });
    expect(attempts).toBeGreaterThan(1);
    expect(await balance()).toMatchObject({ balanceNanos: 1730000000n, heldNanos: 1230000000n, status: 'REVIEW' });
    await expect(wallet.reserve(org, randomUUID(), 'fixture', 'offline', 1n)).rejects.toThrow('reconciliation');
  });
  it('rolls back success and audit atomically on a local commit failure', async () => {
    await approve();
    const broken = new AiWalletRefundRequestService({ model: { ...db, aiWalletTopup: db.aiWalletTopup,
      aiWalletRefundReconciliation: db.aiWalletRefundReconciliation,
      $transaction: (fn: any, opts: any) => db.$transaction(async tx => { const result = await fn(tx);
        if (opts.isolationLevel === 'Serializable') throw Error('synthetic commit failure'); return result; }, opts) } } as any);
    await expect(broken.handleVerifiedRefundEvent(event())).rejects.toThrow('commit failure');
    expect(await balance()).toMatchObject({ balanceNanos: 1230000000n, heldNanos: 1230000000n });
    expect(await db.aiWalletRefundEvent.count({ where: { organizationId: org } })).toBe(0);
    await deliver(event()); expect((await balance()).balanceNanos).toBe(0n);
  });
  it('retains the request when a full charge summary arrives before its individual refund receipt', async () => {
    await approve(); const summary = event('succeeded', { id: chargeId(), object: 'charge', amount_refunded: 123,
      refunds: { has_more: false, data: [{ id: refundId() }] } }, 'charge.refunded');
    await deliver(summary); expect(await balance()).toMatchObject({ balanceNanos: 1230000000n, heldNanos: 1230000000n, status: 'ACTIVE' });
    await deliver(event()); await deliver(summary);
    expect(await balance()).toMatchObject({ balanceNanos: 0n, heldNanos: 0n, status: 'ACTIVE' });
  });
  it.each(['RESERVED', 'UNKNOWN', 'SETTLED'])('refuses reservation/usage history %s', async state => {
    await service.resolve(org, request.id, 'u', 'WITHDRAWN');
    const r = await wallet.reserve(org, randomUUID(), 'fixture', 'offline', 10000000n);
    if (state !== 'RESERVED') await wallet.dispatch(org, r.id);
    if (state === 'UNKNOWN') await wallet.markUnknown(org, r.id, randomUUID());
    if (state === 'SETTLED') await wallet.settle(org, r.id, 10000000n, randomUUID());
    request = await service.request(org, 'u', randomUUID()); await expect(approve()).rejects.toThrow('unused');
    expect(await db.aiWalletRefundReconciliation.count({ where: { organizationId: org } })).toBe(0);
  });
  it('uses original payment identity after customer/subscription changes and while billing is paused', async () => {
    await approve(); await db.organization.update({ where: { id: org }, data: { paymentId: 'cus_changed' } });
    process.env.BILLING_ENABLED = 'false'; process.env.AI_WALLET_ENABLED = 'false';
    await deliver(event()); expect(await balance()).toMatchObject({ balanceNanos: 0n, heldNanos: 0n });
  });
  it('deduplicates concurrent unmatched events before a payment is funded', async () => {
    const e = event('pending', { id: 're_unmatched', charge: 'ch_unmatched', payment_intent: `pi_unmatched_${org}` });
    await Promise.all([deliver(e), deliver(e), deliver(e)]);
    expect(await db.aiWalletRefundEvent.count({ where: { eventId: e.id } })).toBe(1);
    expect((await balance()).status).toBe('ACTIVE');
  });
  it('rejects prior charge-only disputes with no PaymentIntent instead of silently approving a refund', async () => {
    const e = event('needs_response', { id: 'dp_charge_only', object: 'dispute', payment_intent: null }, 'charge.dispute.created');
    await deliver(e); expect((await balance()).status).toBe('ACTIVE');
    await expect(approve()).rejects.toThrow('evidence requires reconciliation');
    expect(await db.aiWalletRefundEvent.count({ where: { eventId: e.id, organizationId: null } })).toBe(1);
  });
  it('keeps early success without review fail closed and detects event identity mutation', async () => {
    const e = event(); await deliver(e); expect((await balance()).status).toBe('REVIEW');
    await expect(deliver({ ...e, data: { object: { ...e.data.object, amount: 1 } } })).rejects.toThrow('identity');
    expect((await balance()).balanceNanos).toBe(1230000000n);
  });
});
