import { createHash, randomUUID } from 'crypto';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletRefundRequestService } from '@gitroom/nestjs-libraries/services/ai-wallet-refund-request.service';
import { AiWalletCheckoutService } from '@gitroom/nestjs-libraries/services/ai-wallet-checkout.service';
import { StripeController } from '../../apps/backend/src/api/routes/stripe.controller';

jest.mock('@gitroom/nestjs-libraries/services/stripe.service', () => ({ StripeService: class {} }));
const fixtureUrl = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixtureUrl ? describe : describe.skip)('explicit late test refund review of immutable signed history', () => {
  let db: PrismaClient, wallet: AiWalletService, service: AiWalletRefundRequestService, f: any;
  const original = { ...process.env }, signer = new Stripe('sk_test_synthetic_not_a_credential');
  const ids = (item = f) => ({ topupId: item.topup.id, chargeId: `ch_${item.topup.id}`, refundId: `re_${item.topup.id}` });
  const review = (item = f, reviewer = service, actor = 'platform-admin') => reviewer.reviewTestTopup(item.org, item.request.id, actor, ids(item));
  const fund = (item: any, topup = item.topup) => wallet.applyVerifiedTopupEvent({ eventId: randomUUID(), organizationId: item.org,
    topupId: topup.id, sessionId: `cs_${topup.id}`, paymentId: `pi_${topup.id}`, customerId: topup.customerId,
    amountCents: topup.amountCents, currency: 'usd', mode: 'payment', paymentStatus: 'paid' });
  const makeFixture = async () => {
    const org = randomUUID(); await db.organization.create({ data: { id: org, name: 'Synthetic late refund' } });
    const topup = await wallet.createTopup(org, randomUUID(), 'cus_synthetic', 500);
    await wallet.bindTopupSession(org, topup.id, `cs_${topup.id}`);
    const item: any = { org, topup }; await fund(item);
    item.request = await service.request(org, 'requester', randomUUID()); return item;
  };
  const event = (status = 'succeeded', changes: any = {}, type = 'refund.updated', item = f) => ({
    id: `evt_${randomUUID()}`, object: 'event', livemode: false, type,
    data: { object: { id: ids(item).refundId, object: 'refund', payment_intent: `pi_${item.topup.id}`,
      charge: ids(item).chargeId, amount: 500, currency: 'usd', status, ...changes } } });
  const summary = (changes: any = {}) => event('charge_status_is_not_refund_status', { id: ids().chargeId, object: 'charge',
    amount_refunded: 500, refunds: { object: 'list', has_more: false, data: [{ id: ids().refundId }] }, ...changes }, 'charge.refunded');
  const deliver = (e: any, target = service) => {
    const hook = new StripeController({ validateRequest: (raw: Buffer, signature: string, secret: string) =>
      signer.webhooks.constructEvent(raw, signature, secret) } as any, new AiWalletCheckoutService(db as any, wallet, target));
    const payload = JSON.stringify(e);
    return hook.stripe({ rawBody: Buffer.from(payload), headers: { 'stripe-signature': signer.webhooks.generateTestHeaderString({
      payload, secret: process.env.STRIPE_SIGNING_KEY! }) } } as any);
  };
  const balance = (item = f) => db.aiWallet.findUniqueOrThrow({ where: { organizationId: item.org } });
  const audit = (item = f) => db.aiWalletRefundEvent.findMany({ where: { organizationId: item.org }, orderBy: { eventId: 'asc' } });
  const held = async (item = f) => {
    expect(await balance(item)).toMatchObject({ balanceNanos: 5000000000n, heldNanos: 5000000000n, status: 'REVIEW' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: item.org, kind: 'REVERSAL' } })).toBe(0);
    expect(await db.aiWalletRefundReconciliation.findUnique({ where: { requestId: item.request.id } })).toBeNull();
  };
  const debited = async (item = f) => {
    expect(await balance(item)).toMatchObject({ balanceNanos: 0n, heldNanos: 0n, status: 'REVIEW' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: item.org, kind: 'FUNDING' } })).toBe(1);
    expect(await db.aiWalletLedger.findMany({ where: { organizationId: item.org, kind: 'REVERSAL' } })).toMatchObject([
      { externalKey: `refund:${ids(item).refundId}`, amountNanos: 5000000000n, refundRequestId: item.request.id }]);
    expect(await db.aiWalletRefundRequest.findUnique({ where: { id: item.request.id } })).toMatchObject({ status: 'REFUNDED', resolvedByUserId: 'platform-admin' });
  };
  beforeAll(async () => {
    const u = new URL(fixtureUrl!);
    if (u.hostname !== '127.0.0.1' || u.pathname !== '/ep_ai_wallet_test' || u.username !== 'isolated') throw Error('Owned isolated fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixtureUrl } } }); await db.$connect();
  });
  beforeEach(async () => {
    Object.assign(process.env, { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true', AI_WALLET_TEST_REFUNDS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_synthetic_not_a_credential', STRIPE_SIGNING_KEY: 'whsec_synthetic_fixture' });
    wallet = new AiWalletService({ model: db } as any); service = new AiWalletRefundRequestService({ model: db } as any);
    f = await makeFixture();
  });
  afterAll(async () => { process.env = original; await db?.$disconnect(); });

  it('keeps signed early success held until explicit review, preserves audit and replays original review identity after restart', async () => {
    const e = event(); await Promise.all([deliver(e), deliver(e)]); await held();
    const before = await audit();
    expect(before).toMatchObject([{ outcome: 'UNCERTAIN', evidence: { status: 'succeeded' } }]);
    const first = await review(); expect(first.state).toBe('SUCCEEDED'); await debited();
    const binding = await db.aiWalletRefundReconciliation.findUniqueOrThrow({ where: { requestId: f.request.id } });
    const restarted = new AiWalletRefundRequestService({ model: db } as any);
    const repeats = await Promise.all([review(f, restarted, 'different-admin'), review()]);
    expect(repeats).toEqual([first, first]);
    expect(await db.aiWalletRefundReconciliation.findUnique({ where: { requestId: f.request.id } })).toEqual(binding);
    expect(await audit()).toEqual(before);
    await deliver(e); await deliver(event('pending')); await deliver(event()); await debited();
    await expect(service.reviewTestTopup(f.org, f.request.id, 'admin', { ...ids(), refundId: 're_changed' })).rejects.toThrow('identity');
    await expect(deliver({ ...e, data: { object: { ...e.data.object, amount: 1 } } })).rejects.toThrow('identity');
  });
  it('keeps late success behind the default-off, test-key, live and Connect boundaries', async () => {
    await deliver(event()); const before = await audit();
    delete process.env.AI_WALLET_TEST_REFUNDS_ENABLED;
    await expect(review()).rejects.toThrow('disabled');
    process.env.AI_WALLET_TEST_REFUNDS_ENABLED = 'true'; process.env.STRIPE_SECRET_KEY = 'sk_live_synthetic';
    await expect(review()).rejects.toThrow('test account');
    process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_not_a_credential';
    await expect(deliver({ ...event(), livemode: true })).rejects.toThrow('Live');
    await expect(deliver({ ...event(), account: 'acct_synthetic' })).rejects.toThrow('Connect');
    expect(await audit()).toEqual(before); await held();
    await review(); await debited();
    expect(await service.summary(f.org)).toMatchObject({ requiresReconciliation: true, eligibleNanos: '0' });
  });
  it.each(['pending-first', 'success-first'])('requires explicit retry for pending history and accepts delayed pending: %s', async order => {
    await deliver(event('pending')); await expect(review()).rejects.toThrow('terminal success'); await held();
    if (order === 'pending-first') await deliver(event('pending'));
    await deliver(event()); if (order === 'success-first') await deliver(event('pending'));
    await held(); await review(); await deliver(event('pending')); await debited();
  });
  it.each(['before', 'after'])('uses a complete charge summary only as corroboration %s the refund receipt', async order => {
    const charge = summary();
    if (order === 'before') await deliver(charge);
    await deliver(event()); if (order === 'after') await deliver(charge);
    expect((await db.aiWalletRefundEvent.findUniqueOrThrow({ where: { eventId: charge.id } })).evidence).toMatchObject({ refundsHasMore: false });
    await held(); await review(); await deliver(summary()); await debited();
    expect((await db.aiWalletRefundReconciliation.findUniqueOrThrow({ where: { requestId: f.request.id } })).state).toBe('SUCCEEDED');
  });
  it('refuses a complete charge summary alone', async () => { await deliver(summary()); await expect(review()).rejects.toThrow('terminal success'); await held(); });
  it.each([
    { refunds: { data: [] } }, { refunds: { data: [{ id: null }], has_more: false } }, { refunds: { data: {}, has_more: false } }, { refunds: { data: [{ id: 're_other' }], has_more: true } },
    { refunds: { data: [{ id: 're_other' }], has_more: false } },
    { refunds: { data: [{ id: 're_other' }, { id: 're_second' }], has_more: false } },
    { amount_refunded: 499 }, { amount: 499 }, { currency: 'eur' }, { id: 'ch_wrong' }, { payment_intent: null },
  ])('refuses incompatible or incomplete charge corroboration %j', async changes => {
    await deliver(event()); await deliver(summary(changes)); await expect(review()).rejects.toThrow('reconciliation'); await held();
  });
  it.each(['missing', 'more', 'multiple'])('refuses %s completeness even when the expected refund ID is present', async kind => {
    const refunds = { data: [{ id: ids().refundId }, ...(kind === 'multiple' ? [{ id: 're_second' }] : [])],
      ...(kind === 'missing' ? {} : { has_more: kind === 'more' }) };
    await deliver(summary({ refunds })); await deliver(event());
    await expect(review()).rejects.toThrow('reconciliation'); await held();
  });
  it('refuses immutable old charge evidence with no completeness field', async () => {
    await deliver(event()); const e = summary().data.object;
    await db.aiWalletRefundEvent.create({ data: { eventId: randomUUID(), organizationId: f.org, paymentId: `pi_${f.topup.id}`,
      fingerprint: 'synthetic-old-summary', outcome: 'UNCERTAIN', evidence: { organizations: [f.org], type: 'charge.refunded', object: 'charge',
        id: e.id, paymentId: e.payment_intent, chargeId: e.id, amount: 500, amountRefunded: 500, currency: 'usd', refundIds: [ids().refundId] } } });
    await expect(review()).rejects.toThrow('reconciliation'); await held();
  });
  it.each([
    ['failed', 'refund.updated'], ['canceled', 'refund.created'], ['requires_action', 'refund.updated'], [null, 'refund.updated'],
    ['succeeded', 'refund.failed'], ['pending', 'refund.failed'], ['failed', 'refund.failed'],
    ['closed', 'charge.dispute.closed'], ['won', 'charge.dispute.funds_reinstated'], ['lost', 'charge.dispute.funds_withdrawn'],
    ['needs_response', 'charge.dispute.created'],
  ])('never cleans contradictory %s / %s history through later pending and success', async (status, type) => {
    await deliver(event(status as any, type.startsWith('charge.dispute.') ? { object: 'dispute', id: `dp_${randomUUID()}` } : {}, type));
    await deliver(event('pending')); await deliver(event()); await expect(review()).rejects.toThrow('reconciliation'); await held();
  });
  it.each(['failed', 'canceled', 'requires_action', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated'])(
    'refuses adverse %s arriving after success but before review', async adverse => {
      await deliver(event());
      await deliver(adverse.startsWith('charge.') ? event('closed', { object: 'dispute', id: 'dp_after_success' }, adverse) : event(adverse));
      await expect(review()).rejects.toThrow('reconciliation'); await held();
    });
  it.each(['failed', 'canceled', 'requires_action', 'dispute'])('retains the debit and sticky uncertainty after later %s', async status => {
    await deliver(event()); await review();
    await deliver(status === 'dispute' ? event('closed', { object: 'dispute', id: 'dp_later' }, 'charge.dispute.closed') : event(status));
    await deliver(event('pending')); await deliver(event());
    expect((await review()).state).toBe('UNCERTAIN'); await debited();
  });
  it.each([{ payment_intent: null }, { charge: null }, { amount: 499 }, { currency: 'eur' }, { id: 're_other' }, { charge: 'ch_other' }])(
    'refuses mismatched refund history even with later exact success %j', async changes => {
      await deliver(event('pending', changes)); await deliver(event()); await expect(review()).rejects.toThrow('reconciliation'); await held();
    });
  it('retains identity-only null-org evidence and rejects it when the refund becomes identifiable', async () => {
    const e = event('failed', { payment_intent: null, charge: null }); await deliver(e);
    expect(await db.aiWalletRefundEvent.findUnique({ where: { eventId: e.id } })).toMatchObject({ organizationId: null, outcome: 'UNMATCHED' });
    await deliver(event()); await expect(review()).rejects.toThrow('reconciliation'); await held();
  });
  it('isolates subscription metadata and rejects foreign charge/refund history regardless of matching later success', async () => {
    await deliver(event('failed', { id: 're_subscription', charge: 'ch_subscription', payment_intent: `pi_subscription_${f.org}`,
      metadata: { topupId: f.topup.id, organizationId: f.org } }));
    expect((await balance()).status).toBe('ACTIVE');
    const other = await makeFixture(); await deliver(event('succeeded', { payment_intent: `pi_${other.topup.id}` }));
    await deliver(event()); await expect(review()).rejects.toThrow('reconciliation'); await held();
    expect(await balance(other)).toMatchObject({ status: 'REVIEW', balanceNanos: 5000000000n });
    await expect(service.reviewTestTopup(other.org, f.request.id, 'admin', ids())).rejects.toThrow('unused');
  });
  it.each(['FAILED', 'UNCERTAIN'])('does not reset an existing %s binding', async state => {
    await review(); await deliver(state === 'FAILED' ? event('failed') : event('requires_action'));
    const before = await db.aiWalletRefundReconciliation.findUnique({ where: { requestId: f.request.id } });
    expect((await review()).state).toBe(state);
    expect(await db.aiWalletRefundReconciliation.findUnique({ where: { requestId: f.request.id } })).toEqual(before);
    expect((await balance()).balanceNanos).toBe(5000000000n);
  });
  it.each(['binding', 'ledger', 'commit'])('rolls back late review atomically at %s', async stage => {
    await deliver(event()); const before = await audit();
    const broken = new AiWalletRefundRequestService({ model: { $transaction: (fn: any, opts: any) => db.$transaction(async tx => {
      const intercepted = new Proxy(tx, { get(target, property) {
        const value = (target as any)[property];
        if ((stage === 'binding' && property === 'aiWalletRefundReconciliation') || (stage === 'ledger' && property === 'aiWalletLedger'))
          return new Proxy(value, { get(delegate, method) { return method === 'create' ? async (args: any) => {
            await delegate.create(args); throw Error(`synthetic ${stage} failure`);
          } : delegate[method]; } });
        return value;
      } });
      const result = await fn(intercepted); if (stage === 'commit') throw Error('synthetic commit failure'); return result;
    }, opts) } } as any);
    await expect(review(f, broken)).rejects.toThrow(`synthetic ${stage} failure`); await held();
    expect(await audit()).toEqual(before);
    expect(await db.aiWalletRefundRequest.findUnique({ where: { id: f.request.id } })).toMatchObject({ status: 'REQUESTED', resolvedAt: null });
    await review(); await debited();
  });
  it('serializes concurrent late review, real signed delivery and competing spending', async () => {
    await deliver(event());
    const results = await Promise.allSettled([review(), review(), deliver(event('pending')), deliver(event()),
      wallet.reserve(f.org, randomUUID(), 'fixture', 'offline', 1n)]);
    expect(results.slice(0, 4).every(r => r.status === 'fulfilled')).toBe(true); expect(results[4].status).toBe('rejected'); await debited();
  });
  it.each(['WITHDRAWN', 'REJECTED'] as const)('serializes late review with %s without releasing the same value twice', async outcome => {
    await deliver(event());
    const result = await Promise.allSettled([review(), service.resolve(f.org, f.request.id, 'resolver', outcome)]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    if (result[0].status === 'fulfilled') await debited();
    else {
      expect(await balance()).toMatchObject({ balanceNanos: 5000000000n, heldNanos: 0n, status: 'REVIEW' });
      expect(await db.aiWalletRefundReconciliation.findUnique({ where: { requestId: f.request.id } })).toBeNull();
    }
  });
  it('serializes late review with newly funded value and never refunds that new money', async () => {
    const extra = await wallet.createTopup(f.org, randomUUID(), 'cus_synthetic', 250);
    await wallet.bindTopupSession(f.org, extra.id, `cs_${extra.id}`); await deliver(event());
    const [result] = await Promise.allSettled([review(), fund(f, extra)]);
    expect(await balance()).toMatchObject({ balanceNanos: result.status === 'fulfilled' ? 2500000000n : 7500000000n,
      heldNanos: result.status === 'fulfilled' ? 0n : 5000000000n, status: 'REVIEW' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: f.org, kind: 'REVERSAL' } })).toBe(result.status === 'fulfilled' ? 1 : 0);
  });
  it.each(['foreign-payment', 'missing-payment', 'embedded-refund'])('re-resolves paused prelookup across a new review binding: %s', async kind => {
    await deliver(event()); const other = await makeFixture();
    let resume!: () => void, paused!: () => void, first = true;
    const resumed = new Promise<void>(r => { resume = r; }), reached = new Promise<void>(r => { paused = r; });
    const stale = new AiWalletRefundRequestService({ model: { $transaction: async (fn: any, opts: any) => {
      const result = await db.$transaction(fn, opts);
      if (opts.isolationLevel === 'RepeatableRead' && first) { first = false; paused(); await resumed; }
      return result;
    } } } as any);
    const e = kind === 'embedded-refund' ? summary({ id: `ch_${other.topup.id}`, payment_intent: `pi_${other.topup.id}` })
      : event('succeeded', { payment_intent: kind === 'foreign-payment' ? `pi_${other.topup.id}` : null });
    const delivery = deliver(e, stale); await reached;
    try { await review(); } finally { resume(); }
    await delivery;
    const row = await db.aiWalletRefundEvent.findUniqueOrThrow({ where: { eventId: e.id } });
    expect((row.evidence as any).organizations).toEqual((kind !== 'missing-payment' ? [f.org, other.org] : [f.org]).sort());
    expect((await balance()).status).toBe('REVIEW'); expect((await review()).state).toBe('UNCERTAIN'); await debited();
    if (kind !== 'missing-payment') expect((await balance(other)).status).toBe('REVIEW');
  });
  it('keeps before-funding evidence blocked rather than creating a retrospective request', async () => {
    const org = randomUUID(); await db.organization.create({ data: { id: org, name: 'Synthetic before funding' } });
    const topup = await wallet.createTopup(org, randomUUID(), 'cus_synthetic', 500);
    await wallet.bindTopupSession(org, topup.id, `cs_${topup.id}`);
    const early = { org, topup, request: f.request }; await deliver(event('succeeded', {}, 'refund.updated', early));
    await fund(early);
    expect(await balance(early)).toMatchObject({ balanceNanos: 5000000000n, heldNanos: 0n, status: 'REVIEW' });
    await expect(service.request(org, 'u', randomUUID())).rejects.toThrow('reconciliation');
    await expect(review(early)).rejects.toThrow('unused');
  });
  it.each(['released-reservation', 'spent', 'extra-funding', 'partial-hold', 'no-request'])('refuses late success with %s', async kind => {
    if (kind === 'released-reservation' || kind === 'spent' || kind === 'no-request') {
      await service.resolve(f.org, f.request.id, 'u', 'WITHDRAWN');
      if (kind !== 'no-request') {
        const reservation = await wallet.reserve(f.org, randomUUID(), 'fixture', 'offline', 10000000n);
        if (kind === 'spent') { await wallet.dispatch(f.org, reservation.id); await wallet.settle(f.org, reservation.id, 10000000n, randomUUID()); }
        else await wallet.cancelBeforeDispatch(f.org, reservation.id);
        f.request = await service.request(f.org, 'requester', randomUUID());
      }
    }
    if (kind === 'extra-funding') { const extra = await wallet.createTopup(f.org, randomUUID(), 'cus_synthetic', 250);
      await wallet.bindTopupSession(f.org, extra.id, `cs_${extra.id}`); await fund(f, extra); }
    if (kind === 'partial-hold') await db.aiWallet.update({ where: { organizationId: f.org }, data: { heldNanos: 4990000000n } });
    await deliver(event()); await expect(review()).rejects.toThrow('unused');
    expect(await db.aiWalletLedger.count({ where: { organizationId: f.org, kind: 'REVERSAL' } })).toBe(0);
  });
  describe('complete current-account provider proof supplements absent charge summaries', () => {
    const receipt = () => ({ accountId: 'acct_synthetic', observedAt: Date.now(),
      charge: { id: ids().chargeId, paymentId: `pi_${f.topup.id}`, customerId: f.topup.customerId,
        amount: 500, amountRefunded: 500, currency: 'usd', livemode: false, paid: true, captured: true, refunded: true, disputed: false },
      refunds: { object: 'list', hasMore: false, data: [{ id: ids().refundId, paymentId: `pi_${f.topup.id}`,
        chargeId: ids().chargeId, amount: 500, currency: 'usd', status: 'succeeded' }] } });
    const withProof = (proof: any = receipt(), target = service) => target.reviewTestTopup(f.org, f.request.id, 'platform-admin', ids(), proof);
    const actualHistory = async () => { await deliver(summary({ refunds: undefined })); await deliver(event()); };
    it.each(['charge-first', 'refund-first', 'legacy-null-fields'])('reconciles once with %s and preserves all signed audit rows', async order => {
      const charge = summary({ refunds: undefined }), refund = event();
      if (order === 'legacy-null-fields') {
        await deliver(refund);
        // Seed a separate synthetic pre-repair receipt; never edit persisted rows.
        await db.aiWalletRefundEvent.create({ data: { eventId: charge.id, organizationId: f.org,
          paymentId: `pi_${f.topup.id}`, fingerprint: createHash('sha256').update(JSON.stringify(charge)).digest('hex'),
          outcome: 'UNCERTAIN', evidence: { organizations: [f.org], type: 'charge.refunded', object: 'charge',
            id: ids().chargeId, chargeId: ids().chargeId, paymentId: `pi_${f.topup.id}`, amount: 500,
            amountRefunded: 500, currency: 'usd', status: 'succeeded', refundIds: null, refundsHasMore: null } } });
      } else if (order === 'refund-first') { await deliver(refund); await deliver(charge); }
      else { await deliver(charge); await deliver(refund); }
      const before = await audit(); await held(); await expect(review()).rejects.toThrow('reconciliation');
      const results = await Promise.all([withProof(), withProof(receipt(), new AiWalletRefundRequestService({ model: db } as any))]);
      expect(results[0]).toEqual(results[1]); await debited();
      const after = await audit(); expect(after.filter(a => a.outcome !== 'VERIFIED_PROVIDER_READ')).toEqual(before);
      expect(after.filter(a => a.outcome === 'VERIFIED_PROVIDER_READ')).toMatchObject([{ evidence: {
        source: 'STRIPE_TEST_API_READ', accountId: 'acct_synthetic', refunds: { hasMore: false, data: [{ status: 'succeeded' }] } } }]);
      await deliver(charge); await deliver(refund); await withProof(); await debited();
      expect(await audit()).toEqual(after);
    });
    it('does not mistake user-supplied proof in the HTTP body for server-only read evidence', async () => {
      await actualHistory(); await expect(service.reviewTestTopup(f.org, f.request.id, 'platform-admin',
        { ...ids(), providerProof: receipt() } as any)).rejects.toThrow('reconciliation'); await held();
    });
    it.each([
      ['stale', (p: any) => p.observedAt -= 30001], ['future', (p: any) => p.observedAt += 60000],
      ['account', (p: any) => p.accountId = 'invalid'], ['live', (p: any) => p.charge.livemode = true],
      ['wrong-charge', (p: any) => p.charge.id = 'ch_other'], ['wrong-payment', (p: any) => p.charge.paymentId = 'pi_other'],
      ['wrong-customer', (p: any) => p.charge.customerId = 'cus_other'], ['partial-charge', (p: any) => p.charge.amountRefunded = 499],
      ['charge-amount', (p: any) => p.charge.amount = 501], ['charge-currency', (p: any) => p.charge.currency = 'eur'],
      ['provider-dispute', (p: any) => p.charge.disputed = true], ['unpaid', (p: any) => p.charge.paid = false], ['uncaptured', (p: any) => p.charge.captured = false],
      ['not-refunded', (p: any) => p.charge.refunded = false], ['page', (p: any) => p.refunds.hasMore = true],
      ['missing-completeness', (p: any) => delete p.refunds.hasMore], ['list-shape', (p: any) => p.refunds.object = 'refund'],
      ['empty', (p: any) => p.refunds.data = []], ['multiple', (p: any) => p.refunds.data.push({ ...p.refunds.data[0] })],
      ['wrong-refund', (p: any) => p.refunds.data[0].id = 're_other'], ['refund-charge', (p: any) => p.refunds.data[0].chargeId = 'ch_other'],
      ['refund-payment', (p: any) => p.refunds.data[0].paymentId = 'pi_other'], ['partial-refund', (p: any) => p.refunds.data[0].amount = 499],
      ['refund-currency', (p: any) => p.refunds.data[0].currency = 'eur'], ['pending', (p: any) => p.refunds.data[0].status = 'pending'],
      ['failed', (p: any) => p.refunds.data[0].status = 'failed'], ['canceled', (p: any) => p.refunds.data[0].status = 'canceled'],
    ])('refuses %s provider evidence without writing an audit receipt or debit', async (_, change) => {
      await actualHistory(); const before = await audit(), p = receipt(); (change as Function)(p);
      await expect(withProof(p)).rejects.toThrow('proof'); expect(await audit()).toEqual(before); await held();
    });
    it.each([
      { refunds: { data: {}, has_more: false } }, { refunds: { data: [{ id: null }], has_more: false } },
      { refunds: { has_more: true, data: [] } }, { refunds: { data: [{ id: 're_other' }], has_more: false } },
      { refunds: { data: [{ id: 're_other' }, { id: 're_second' }], has_more: false } },
      { amount_refunded: 499 }, { currency: 'eur' },
    ])('cannot override explicit contradictory or malformed charge history %j', async changes => {
      await deliver(event()); await deliver(summary(changes)); await expect(withProof()).rejects.toThrow('reconciliation'); await held();
    });
    it.each(['failed', 'canceled', 'dispute', 'other-refund'])('cannot override adverse %s signed history', async kind => {
      await actualHistory(); await deliver(kind === 'dispute' ? event('closed', { object: 'dispute', id: 'dp_proof' }, 'charge.dispute.closed') :
        event(kind === 'other-refund' ? 'succeeded' : kind, kind === 'other-refund' ? { id: 're_other' } : {}));
      await expect(withProof()).rejects.toThrow('reconciliation'); await held();
    });
    it('requires signed terminal success even with complete provider reads', async () => {
      await deliver(summary({ refunds: undefined })); await expect(withProof()).rejects.toThrow('terminal success'); await held();
    });
    it('keeps later omitted summaries uncertain without restoring or double-debiting value', async () => {
      await actualHistory(); await withProof(); await deliver(summary({ refunds: undefined }));
      expect((await withProof()).state).toBe('UNCERTAIN'); await deliver(event()); await debited();
      expect((await withProof()).state).toBe('UNCERTAIN');
    });
    it('cannot override a malformed explicit list or an old known-incomplete list containing the expected ID', async () => {
      await deliver(event()); await deliver(summary({ refunds: { object: 'wrong', has_more: false, data: [{ id: ids().refundId }] } }));
      await expect(withProof()).rejects.toThrow('reconciliation'); await held();
    });
    it('does not accept API reads without signed history', async () => {
      await expect(withProof()).rejects.toThrow('Signed refund history');
      expect(await audit()).toHaveLength(0);
      expect(await balance()).toMatchObject({ balanceNanos: 5000000000n, heldNanos: 5000000000n });
    });
    it.each(['released-reservation', 'spent', 'partial-hold'])('preserves full unused top-up checks with provider proof: %s', async kind => {
      if (kind === 'partial-hold') await db.aiWallet.update({ where: { organizationId: f.org }, data: { heldNanos: 4990000000n } });
      else {
        await service.resolve(f.org, f.request.id, 'u', 'WITHDRAWN');
        const r = await wallet.reserve(f.org, randomUUID(), 'fixture', 'offline', 10000000n);
        if (kind === 'spent') { await wallet.dispatch(f.org, r.id); await wallet.settle(f.org, r.id, 10000000n, randomUUID()); }
        else await wallet.cancelBeforeDispatch(f.org, r.id);
        f.request = await service.request(f.org, 'requester', randomUUID());
      }
      await actualHistory(); await expect(withProof()).rejects.toThrow('unused');
      expect(await db.aiWalletLedger.count({ where: { organizationId: f.org, kind: 'REVERSAL' } })).toBe(0);
    });
    it.each(['WITHDRAWN', 'REJECTED'] as const)('serializes provider-proof review against %s and spending', async outcome => {
      await actualHistory();
      const results = await Promise.allSettled([withProof(), service.resolve(f.org, f.request.id, 'resolver', outcome),
        wallet.reserve(f.org, randomUUID(), 'fixture', 'offline', 1n)]);
      expect(results.slice(0, 2).filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(results[2].status).toBe('rejected');
      if (results[0].status === 'fulfilled') await debited();
      else {
        expect(await balance()).toMatchObject({ balanceNanos: 5000000000n, heldNanos: 0n, status: 'REVIEW' });
        expect((await audit()).filter(a => a.outcome === 'VERIFIED_PROVIDER_READ')).toHaveLength(0);
      }
    });
    it('rolls back the new proof receipt if the ledger debit fails', async () => {
      await actualHistory(); const before = await audit();
      const spy = jest.spyOn(service as any, 'debitRefund').mockRejectedValueOnce(Error('synthetic failure'));
      await expect(withProof()).rejects.toThrow('synthetic failure'); spy.mockRestore();
      expect(await audit()).toEqual(before); await held();
    });
    it('serializes review against a late adverse receipt', async () => {
      await actualHistory(); const adverse = event('failed');
      await Promise.allSettled([withProof(), deliver(adverse)]);
      const w = await balance();
      if (w.balanceNanos === 0n) {
        await debited(); expect((await withProof()).state).toBe('UNCERTAIN');
      } else { await held(); await expect(withProof()).rejects.toThrow('reconciliation'); }
    });
  });

});
