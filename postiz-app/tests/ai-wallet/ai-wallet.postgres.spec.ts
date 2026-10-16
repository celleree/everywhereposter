import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';

const fixtureUrl = process.env.AI_WALLET_TEST_DATABASE_URL;
const databaseSuite = fixtureUrl ? describe : describe.skip;

databaseSuite('prepaid AI wallet against isolated PostgreSQL', () => {
  let db: PrismaClient;
  let service: AiWalletService;
  let org: string;
  const priorBilling = process.env.BILLING_ENABLED;
  const priorWallet = process.env.AI_WALLET_ENABLED;

  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ep_ai_wallet_test') {
      throw new Error('Wallet tests require the explicit loopback ep_ai_wallet_test fixture.');
    }
    db = new PrismaClient({ datasources: { db: { url: fixtureUrl } } });
    await db.$connect();
    service = new AiWalletService({ model: db } as any);
  });
  beforeEach(async () => {
    process.env.BILLING_ENABLED = 'true';
    process.env.AI_WALLET_ENABLED = 'true';
    org = `ai-wallet-test-${randomUUID()}`;
    await db.organization.create({ data: { id: org, name: 'Synthetic wallet fixture' } });
  });
  afterAll(async () => {
    if (priorBilling === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = priorBilling;
    if (priorWallet === undefined) delete process.env.AI_WALLET_ENABLED; else process.env.AI_WALLET_ENABLED = priorWallet;
    await db?.$disconnect();
  });

  const topup = async (cents = 1) => service.createTopup(org, randomUUID(), 'cus_synthetic', cents);
  const paid = (intent: any, overrides: any = {}) => ({
    eventId: `evt_${intent.id}`, organizationId: org, topupId: intent.id,
    sessionId: `cs_${intent.id}`, paymentId: `pi_${intent.id}`, customerId: 'cus_synthetic',
    amountCents: intent.amountCents, currency: 'usd', mode: 'payment' as const,
    paymentStatus: 'paid' as const, ...overrides,
  });
  const fund = async () => { const intent = await topup(); await service.applyVerifiedTopupEvent(paid(intent)); return intent; };
  const reserve = (key = randomUUID()) => service.reserve(org, key, 'synthetic-provider', 'synthetic-model', 5000000n);
  const wallet = () => db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } });

  it('fails closed before purchase/reservation writes when either feature flag is off', async () => {
    process.env.AI_WALLET_ENABLED = 'false';
    await expect(reserve()).rejects.toThrow('disabled');
    await expect(topup()).rejects.toThrow('disabled');
    process.env.AI_WALLET_ENABLED = 'true'; process.env.BILLING_ENABLED = 'false';
    await expect(reserve()).rejects.toThrow('disabled');
    expect(await db.aiWallet.count({ where: { organizationId: org } })).toBe(0);
  });

  it('funds exactly once across duplicate event and payment identities', async () => {
    const intent = await topup();
    await Promise.all(Array.from({ length: 4 }, (_, i) => service.applyVerifiedTopupEvent(paid(intent, { eventId: `evt_${intent.id}_${i}` }))));
    await service.applyVerifiedTopupEvent(paid(intent, { eventId: `evt_${intent.id}_0` }));
    expect((await wallet()).balanceNanos).toBe(10000000n);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'FUNDING' } })).toBe(1);
  });

  it('cannot overspend a balance across concurrent jobs', async () => {
    await fund();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => reserve()));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect((await wallet()).heldNanos).toBe(10000000n);
    await expect(reserve()).rejects.toThrow('Insufficient');
  });

  it('creates one hold and one dispatch for concurrent operation retries', async () => {
    await fund();
    const key = randomUUID();
    const reservations = await Promise.all(Array.from({ length: 4 }, () => reserve(key)));
    expect(new Set(reservations.map((r) => r.id)).size).toBe(1);
    const dispatches = await Promise.all(reservations.map((r) => service.dispatch(org, r.id)));
    expect(dispatches.filter((r) => r.dispatch)).toHaveLength(1);
    expect((await wallet()).heldNanos).toBe(5000000n);
  });

  it('settles lower usage once and releases the unused hold', async () => {
    await fund(); const r = await reserve(); await service.dispatch(org, r.id);
    await Promise.all(Array.from({ length: 4 }, () => service.settle(org, r.id, 3000000n, `receipt_${r.id}`)));
    await service.cancelBeforeDispatch(org, r.id);
    expect(await wallet()).toMatchObject({ balanceNanos: 7000000n, heldNanos: 0n });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'USAGE' } })).toBe(1);
    await expect(service.settle(org, r.id, 2000000n, `receipt_${r.id}`)).rejects.toThrow('amount changed');
  });

  it('releases before dispatch but retains ambiguous post-dispatch cancellation', async () => {
    await fund(); const before = await reserve();
    await service.cancelBeforeDispatch(org, before.id); await service.cancelBeforeDispatch(org, before.id);
    expect((await service.dispatch(org, before.id)).dispatch).toBe(false);
    const after = await reserve(); await service.dispatch(org, after.id);
    await service.markUnknown(org, after.id, `receipt_${after.id}`);
    await expect(service.cancelBeforeDispatch(org, after.id)).rejects.toThrow('receipt');
    expect((await wallet()).heldNanos).toBe(5000000n);
    await service.settle(org, after.id, 2000000n, `receipt_${after.id}`);
    expect(await wallet()).toMatchObject({ balanceNanos: 8000000n, heldNanos: 0n });
  });

  it('freezes an above-ceiling receipt without overdraft or guessed debit', async () => {
    await fund(); const r = await reserve(); await service.dispatch(org, r.id);
    await service.settle(org, r.id, 6000000n, `receipt_${r.id}`);
    expect(await wallet()).toMatchObject({ balanceNanos: 10000000n, heldNanos: 5000000n, status: 'REVIEW' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'USAGE' } })).toBe(0);
    await expect(reserve()).rejects.toThrow('reconciliation');
    await expect(topup()).rejects.toThrow('reconciliation');
  });

  it('handles unpaid then paid then late unpaid events without revoking funds', async () => {
    const intent = await topup();
    await service.applyVerifiedTopupEvent(paid(intent, { eventId: 'unpaid_' + intent.id, paymentStatus: 'unpaid', paymentId: null }));
    expect((await wallet()).balanceNanos).toBe(0n);
    await service.applyVerifiedTopupEvent(paid(intent));
    await service.applyVerifiedTopupEvent(paid(intent, { eventId: 'late_' + intent.id, paymentStatus: 'unpaid', paymentId: null }));
    expect((await wallet()).balanceNanos).toBe(10000000n);
  });

  it('rejects mismatched payment metadata without a credit or processed event', async () => {
    const intent = await topup();
    for (const change of [{ amountCents: 2 }, { currency: 'eur' }, { customerId: 'cus_other' }, { mode: 'subscription' }]) {
      await expect(service.applyVerifiedTopupEvent(paid(intent, change))).rejects.toThrow('does not match');
    }
    expect((await wallet()).balanceNanos).toBe(0n);
    expect(await db.aiWalletPaymentEvent.count({ where: { topupId: intent.id } })).toBe(0);
  });

  it('rolls back all funding writes when ledger persistence fails', async () => {
    const intent = await topup();
    const faulty = db.$extends({ query: { aiWalletLedger: { async create() { throw new Error('synthetic ledger failure'); } } } });
    const failingService = new AiWalletService({ model: faulty } as any);
    await expect(failingService.applyVerifiedTopupEvent(paid(intent))).rejects.toThrow('synthetic ledger failure');
    expect((await wallet()).balanceNanos).toBe(0n);
    expect((await db.aiWalletTopup.findUniqueOrThrow({ where: { id: intent.id } })).fundedAt).toBeNull();
    expect(await db.aiWalletPaymentEvent.count({ where: { topupId: intent.id } })).toBe(0);
    await service.applyVerifiedTopupEvent(paid(intent));
    expect((await wallet()).balanceNanos).toBe(10000000n);
  });

  it('keeps verified bookkeeping available while purchase and dispatch are disabled', async () => {
    const intent = await topup();
    process.env.BILLING_ENABLED = 'false'; process.env.AI_WALLET_ENABLED = 'false';
    await service.applyVerifiedTopupEvent(paid(intent));
    expect((await wallet()).balanceNanos).toBe(10000000n);
    await expect(reserve()).rejects.toThrow('disabled');
  });

  it('enforces nonnegative available balance in PostgreSQL itself', async () => {
    await fund();
    await expect(db.aiWallet.update({ where: { organizationId: org }, data: { heldNanos: 11000000n } })).rejects.toThrow();
    expect((await wallet()).heldNanos).toBe(0n);
  });
});
