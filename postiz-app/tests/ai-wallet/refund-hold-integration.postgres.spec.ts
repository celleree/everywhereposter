import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletRefundRequestService } from '@gitroom/nestjs-libraries/services/ai-wallet-refund-request.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { AiWalletCheckoutService } from '@gitroom/nestjs-libraries/services/ai-wallet-checkout.service';
import { walletHoldSnapshot } from '@gitroom/nestjs-libraries/services/ai-wallet-holds';
jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
const fixture = process.env.AI_WALLET_TEST_DATABASE_URL;
// Safety gates. A failure blocks integration; never change expectations
// to treat an acknowledged request or a successful fixture as financial acceptance.
(fixture ? describe : describe.skip)('checkpoint refund holds against reviewed billing stack', () => {
  let db: PrismaClient, wallet: AiWalletService, requests: AiWalletRefundRequestService, org: string;
  const before = { BILLING_ENABLED: process.env.BILLING_ENABLED, AI_WALLET_ENABLED: process.env.AI_WALLET_ENABLED };
  const key = () => `request_${randomUUID()}`;
  beforeAll(async () => {
    const url = new URL(fixture!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/ep_ai_wallet_test' || url.username !== 'isolated') throw Error('Owned fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixture } } }); await db.$connect();
  });
  beforeEach(async () => {
    process.env.BILLING_ENABLED = process.env.AI_WALLET_ENABLED = 'true';
    wallet = new AiWalletService({ model: db } as any); requests = new AiWalletRefundRequestService({ model: db } as any);
    org = randomUUID();
    await db.organization.create({ data: { id: org, name: 'Synthetic hold integration', paymentId: `cus_${org}`,
      subscription: { create: { subscriptionTier: 'LAUNCH_V1', totalChannels: 0, period: 'MONTHLY' } } } });
    await db.aiWallet.create({ data: { organizationId: org, balanceNanos: 10000000000n } });
    const topup = await db.aiWalletTopup.create({ data: { organizationId: org, operationKey: key(), customerId: `cus_${org}`,
      sessionId: `cs_${org}`, paymentId: `pi_${org}`, amountCents: 1000, currency: 'usd', fundedAt: new Date() } });
    await db.aiWalletLedger.create({ data: { organizationId: org, externalKey: key(), kind: 'FUNDING', topupId: topup.id, amountNanos: 10000000000n } });
  });
  afterAll(async () => { for (const [k,v] of Object.entries(before)) v === undefined ? delete process.env[k] : process.env[k] = v; await db?.$disconnect(); });
  const state = () => db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } });
  const reconcile = async (active: boolean) => {
    const repository = { model: db } as any;
    const subscriptions = new SubscriptionRepository(repository, repository, repository, repository, repository);
    const service = new SubscriptionService(subscriptions, { getIntegrationsList: async () => [], changeActiveCron: jest.fn(), restoreActiveCron: jest.fn() } as any,
      { enforceSingleEnabledOwner: jest.fn(), disableOrEnableNonSuperAdminUsers: jest.fn() } as any, repository);
    await service.reconcileLaunchSubscription(`cus_${org}`, async () => active
      ? { status: 'active', identifier: `sub_${org}`, period: 'MONTHLY', cancelAt: null } : null);
  };
  it('serializes competing refund requests with new spending without overlapping funds', async () => {
    const results = await Promise.allSettled([requests.request(org, 'u', key()), requests.request(org, 'u', key()),
      wallet.reserve(org, key(), 'offline', 'fixture', 3000000000n)]);
    const heldRequests = await db.aiWalletRefundRequest.aggregate({ where: { organizationId: org }, _sum: { requestedNanos: true } });
    const heldUsage = await db.aiWalletReservation.aggregate({ where: { organizationId: org }, _sum: { ceilingNanos: true } });
    const s = await state();
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    expect(s.heldNanos).toBe((heldRequests._sum.requestedNanos || 0n) + (heldUsage._sum.ceilingNanos || 0n));
    expect(s.heldNanos).toBeLessThanOrEqual(s.balanceNanos);
    expect(heldRequests._sum.requestedNanos).toBeGreaterThan(0n);
  });
  it('serializes settlement and request replay while preserving the exact refund hold', async () => {
    const usage = await wallet.reserve(org, key(), 'offline', 'fixture', 3000000000n); await wallet.dispatch(org, usage.id);
    const operation = key(); const first = await requests.request(org, 'u', operation);
    expect(first.requestedNanos).toBe('7000000000');
    await Promise.all([wallet.settle(org, usage.id, 2000000000n, `receipt_${usage.id}`),
      wallet.settle(org, usage.id, 2000000000n, `receipt_${usage.id}`), requests.request(org, 'u', operation)]);
    expect(await state()).toMatchObject({ balanceNanos: 8000000000n, heldNanos: 7000000000n });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'USAGE' } })).toBe(1);
    expect(await requests.summary(org)).toMatchObject({ eligibleNanos: '1000000000', refundHeldNanos: '7000000000', usageHeldNanos: '0' });
    await expect(wallet.reserve(org, key(), 'offline', 'fixture', 1000000001n)).rejects.toThrow('Insufficient');
    const restarted = new AiWalletRefundRequestService({ model: db } as any);
    expect((await restarted.request(org, 'u', operation)).id).toBe(first.id);
    await expect(wallet.settle('different-org', usage.id, 2000000000n, `receipt_${usage.id}`)).rejects.toThrow('not found');
  });
  it('preserves requests across real local subscription revocation and recovery without authorizing held value', async () => {
    const usage = await wallet.reserve(org, key(), 'offline', 'fixture', 3000000000n);
    const operation = key(); const first = await requests.request(org, 'u', operation);
    await reconcile(false);
    await expect(wallet.dispatch(org, usage.id, true)).rejects.toThrow('not included');
    expect(await requests.summary(org)).toMatchObject({ refundHeldNanos: '7000000000', usageHeldNanos: '3000000000' });
    await wallet.cancelBeforeDispatch(org, usage.id);
    // Request access is independent of plan/billing flags; revocation releases no refund hold.
    process.env.BILLING_ENABLED = process.env.AI_WALLET_ENABLED = 'false';
    expect((await requests.request(org, 'u', operation)).id).toBe(first.id);
    expect((await requests.request(org, 'u', key())).requestedNanos).toBe('3000000000');
    process.env.BILLING_ENABLED = process.env.AI_WALLET_ENABLED = 'true'; await reconcile(true);
    await expect(wallet.reserve(org, key(), 'offline', 'fixture', 1n)).rejects.toThrow('Insufficient');
    expect(await state()).toMatchObject({ balanceNanos: 10000000000n, heldNanos: 10000000000n });
  });
  it('rejects an understated usage hold before creating a competing refund hold (integration gate)', async () => {
    const usage = await wallet.reserve(org, key(), 'offline', 'fixture', 3000000000n); await wallet.dispatch(org, usage.id);
    // Synthetic drift remains legal under current SQL checks, but must fail the
    // documented service reconciliation contract. Never repair it by stealing a refund hold.
    await db.aiWallet.update({ where: { organizationId: org }, data: { heldNanos: 0n } });
    const result = await requests.request(org, 'u', key()).then(request => ({ request, error: null }), error => ({ request: null, error }));
    if (result.request) {
      await wallet.settle(org, usage.id, 2000000000n, `receipt_${usage.id}`);
      const s = await state();
      expect(s).toMatchObject({ balanceNanos: 8000000000n, heldNanos: 7000000000n });
      // Demonstrate the consequence before failing the admission gate: a new
      // operation can reserve value despite the original $10 request still pending.
      await wallet.reserve(org, key(), 'offline', 'fixture', 1000000000n);
    }
    expect(result.request).toBeNull();
    expect(result.error?.message).toContain('reconciliation');
    expect(await db.aiWalletRefundRequest.count({ where: { organizationId: org } })).toBe(0);
  });
  it('counts only currently held reservation ceilings, including uncertain results and zero-cost settlement', async () => {
    await wallet.reserve(org, key(), 'offline', 'fixture', 1000000000n);
    const dispatched = await wallet.reserve(org, key(), 'offline', 'fixture', 1000000000n); await wallet.dispatch(org, dispatched.id);
    const unknown = await wallet.reserve(org, key(), 'offline', 'fixture', 2000000000n); await wallet.dispatch(org, unknown.id); await wallet.markUnknown(org, unknown.id);
    const settled = await wallet.reserve(org, key(), 'offline', 'fixture', 3000000000n); await wallet.dispatch(org, settled.id); await wallet.settle(org, settled.id, 1000000000n, key());
    const released = await wallet.reserve(org, key(), 'offline', 'fixture', 1000000000n); await wallet.cancelBeforeDispatch(org, released.id);
    const free = await wallet.reserve(org, key(), 'offline', 'fixture', 1000000000n); await wallet.dispatch(org, free.id); await wallet.settle(org, free.id, 0n, key());
    expect(await requests.summary(org)).toMatchObject({ eligibleNanos: '5000000000', usageHeldNanos: '4000000000', requiresReconciliation: false });
    expect((await requests.request(org, 'u', key())).requestedNanos).toBe('5000000000');
  });
  it.each(['under', 'over', 'unknown-accounting'])('fails closed on %s accounting in requests, dispatch, spending and display', async kind => {
    const usage = await wallet.reserve(org, key(), 'offline', 'fixture', 3000000000n);
    if (kind === 'unknown-accounting') await db.aiWalletReservation.update({ where: { id: usage.id }, data: { chargedNanos: 1n } });
    else await db.aiWallet.update({ where: { organizationId: org }, data: { heldNanos: kind === 'under' ? 0n : 4000000000n } });
    await expect(requests.request(org, 'u', key())).rejects.toThrow('reconciliation');
    await expect(wallet.reserve(org, key(), 'offline', 'fixture', 1n)).rejects.toThrow('reconciliation');
    await expect(wallet.dispatch(org, usage.id, true)).rejects.toThrow('reconciliation');
    expect(await requests.summary(org)).toMatchObject({ eligibleNanos: '0', requiresReconciliation: true });
    const prior = process.env.STRIPE_SECRET_KEY; process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_not_a_credential';
    try { expect(await new AiWalletCheckoutService(db as any, wallet).balance(org)).toMatchObject({ status: 'REVIEW', availableNanos: '0' }); }
    finally { prior === undefined ? delete process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_KEY = prior; }
  });
  it.each(['WITHDRAWN', 'REJECTED'] as const)('releases only the %s request once and retains immutable identity, actor and history', async outcome => {
    const usage = await wallet.reserve(org, key(), 'offline', 'fixture', 2000000000n);
    const operation = key(), first = await requests.request(org, 'creator', operation);
    const ledger = await db.aiWalletLedger.findMany({ where: { organizationId: org } });
    const rows = await Promise.all(Array.from({ length: 3 }, () => requests.resolve(org, first.id, 'resolver', outcome)));
    expect(rows[0]).toMatchObject({ ...first, status: outcome, resolvedByUserId: 'resolver', resolvedAt: expect.any(Date) });
    expect(rows.every(r => JSON.stringify(r) === JSON.stringify(rows[0]))).toBe(true);
    expect(await new AiWalletRefundRequestService({ model: db } as any).resolve(org, first.id, 'another-admin', outcome)).toEqual(rows[0]);
    expect(await state()).toMatchObject({ balanceNanos: 10000000000n, heldNanos: usage.ceilingNanos });
    expect(await db.aiWalletLedger.findMany({ where: { organizationId: org } })).toEqual(ledger);
    expect(await requests.request(org, 'creator', operation)).toEqual(rows[0]); // Never creates another request for a reused key.
    expect((await requests.request(org, 'creator', key())).id).not.toBe(first.id);
    await expect(requests.resolve(org, first.id, 'u', outcome === 'WITHDRAWN' ? 'REJECTED' : 'WITHDRAWN')).rejects.toThrow('already resolved');
    await expect(db.aiWalletRefundRequest.update({ where: { id: first.id }, data: { requestedNanos: 1n } })).rejects.toThrow('immutable');
    await expect(db.aiWalletRefundRequest.delete({ where: { id: first.id } })).rejects.toThrow('cannot be deleted');
  });
  it('serializes opposing terminal transitions and isolates requests from another tenant', async () => {
    const row = await requests.request(org, 'u', key());
    await expect(requests.resolve('other-organization', row.id, 'u', 'WITHDRAWN')).rejects.toThrow('not found');
    expect(await state()).toMatchObject({ heldNanos: 10000000000n });
    const outcomes = await Promise.allSettled([requests.resolve(org, row.id, 'admin', 'WITHDRAWN'), requests.resolve(org, row.id, 'platform', 'REJECTED')]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await state()).toMatchObject({ balanceNanos: 10000000000n, heldNanos: 0n });
    await expect(requests.resolve(org, row.id, 'admin', 'APPROVED' as any)).rejects.toThrow('Invalid');
  });
  it('serializes terminal release with settlement, spending and a new request without losing holds or debiting twice', async () => {
    const usage = await wallet.reserve(org, key(), 'offline', 'fixture', 3000000000n); await wallet.dispatch(org, usage.id);
    const row = await requests.request(org, 'u', key());
    const contenders = [wallet.reserve(org, key(), 'offline', 'fixture', 1000000000n), requests.request(org, 'u', key())]
      .map(p => p.catch(e => { expect(e.message).toMatch(/Insufficient|No unused/); }));
    await Promise.all([requests.resolve(org, row.id, 'u', 'WITHDRAWN'),
      wallet.settle(org, usage.id, 2000000000n, `receipt_${usage.id}`), ...contenders]);
    await wallet.settle(org, usage.id, 2000000000n, `receipt_${usage.id}`);
    expect(await state()).toMatchObject({ balanceNanos: 8000000000n });
    expect(await db.$transaction(tx => walletHoldSnapshot(tx, org))).toMatchObject({ reconciled: true });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'USAGE' } })).toBe(1);
  });
  it('rolls back a terminal transition with its counter release and refuses inconsistent refund holds', async () => {
    const row = await requests.request(org, 'u', key());
    const broken = new AiWalletRefundRequestService({ model: { $transaction: (fn: any, opts: any) => db.$transaction(async tx => { await fn(tx); throw Error('synthetic commit failure'); }, opts) } } as any);
    await expect(broken.resolve(org, row.id, 'u', 'WITHDRAWN')).rejects.toThrow('commit failure');
    expect((await requests.summary(org)).requests[0]).toMatchObject({ status: 'REQUESTED', resolvedAt: null });
    expect(await state()).toMatchObject({ heldNanos: 10000000000n });
    await db.aiWallet.update({ where: { organizationId: org }, data: { heldNanos: 9000000000n } });
    await expect(requests.resolve(org, row.id, 'u', 'REJECTED')).rejects.toThrow('reconciliation');
    await expect(wallet.reserve(org, key(), 'offline', 'fixture', 1n)).rejects.toThrow('reconciliation');
    expect((await requests.summary(org)).requests[0].status).toBe('REQUESTED');
  });
  it('releases only the refund hold on a REVIEW wallet while retaining uncertain provider exposure', async () => {
    const usage = await wallet.reserve(org, key(), 'offline', 'fixture', 3000000000n); await wallet.dispatch(org, usage.id);
    const row = await requests.request(org, 'u', key());
    await wallet.settle(org, usage.id, 4000000000n, `receipt_${usage.id}`);
    expect(await requests.resolve(org, row.id, 'platform', 'REJECTED')).toMatchObject({ status: 'REJECTED' });
    expect(await state()).toMatchObject({ status: 'REVIEW', balanceNanos: 10000000000n, heldNanos: 3000000000n });
    expect(await wallet.quotedOperation(org, usage.operationKey)).toMatchObject({ state: 'UNKNOWN', reportedNanos: 4000000000n });
    await expect(wallet.reserve(org, key(), 'offline', 'fixture', 1n)).rejects.toThrow('reconciliation');
    expect(await requests.summary(org)).toMatchObject({ eligibleNanos: '0', requiresReconciliation: true, refundHeldNanos: '0' });
  });
  it('allows withdrawal while subscription/flags are revoked and never resurrects it on recovery', async () => {
    const usage = await wallet.reserve(org, key(), 'offline', 'fixture', 3000000000n);
    const operation = key(), row = await requests.request(org, 'u', operation); await reconcile(false);
    await expect(wallet.dispatch(org, usage.id, true)).rejects.toThrow('not included');
    process.env.BILLING_ENABLED = process.env.AI_WALLET_ENABLED = 'false';
    await requests.resolve(org, row.id, 'admin', 'WITHDRAWN');
    expect(await requests.summary(org)).toMatchObject({ eligibleNanos: '7000000000', usageHeldNanos: '3000000000', refundHeldNanos: '0' });
    process.env.BILLING_ENABLED = process.env.AI_WALLET_ENABLED = 'true'; await reconcile(true);
    expect((await wallet.dispatch(org, usage.id, true)).dispatch).toBe(true);
    await wallet.settle(org, usage.id, 0n, key());
    expect((await requests.request(org, 'u', operation)).status).toBe('WITHDRAWN');
    expect(await state()).toMatchObject({ balanceNanos: 10000000000n, heldNanos: 0n });
  });
  it('pages past 100 equal-timestamp requests even when the cursor row is resolved', async () => {
    const ids = Array.from({ length: 105 }, () => randomUUID()).sort();
    const oldest = await db.aiWalletRefundRequest.aggregate({ where: { status: 'REQUESTED' }, _min: { createdAt: true } });
    const createdAt = new Date((oldest._min.createdAt?.getTime() || Date.now()) - 1000);
    await db.aiWalletRefundRequest.createMany({ data: ids.map(id => ({ id, organizationId: org, operationKey: key(), requestedByUserId: 'u', requestedNanos: 1n, createdAt })) });
    await db.aiWallet.update({ where: { organizationId: org }, data: { heldNanos: 105n } });
    const first = await requests.reviewQueue(); expect(first.requests.map(r => r.id)).toEqual(ids.slice(0, 100));
    await requests.resolve(org, ids[99], 'platform', 'REJECTED');
    const second = await requests.reviewQueue(first.nextCursor!);
    expect(second.requests.filter(r => r.organizationId === org).map(r => r.id)).toEqual(ids.slice(100));
    expect((await requests.reviewQueue()).requests.some(r => r.id === ids[99])).toBe(false);
    await expect(requests.reviewQueue('invalid-cursor')).rejects.toThrow('cursor');
  });
});
