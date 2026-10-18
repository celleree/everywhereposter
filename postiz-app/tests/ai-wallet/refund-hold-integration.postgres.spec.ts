import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletRefundRequestService } from '@gitroom/nestjs-libraries/services/ai-wallet-refund-request.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
const fixture = process.env.AI_WALLET_TEST_DATABASE_URL;
// Audit-only safety gates. A failure blocks integration; never change expectations
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
});
