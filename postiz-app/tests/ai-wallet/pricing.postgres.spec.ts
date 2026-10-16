import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletDispatchService } from '@gitroom/nestjs-libraries/services/ai-wallet-dispatch.service';
import { PREPAID_AI_POLICY, PricingQuote, quotedCharge } from '@gitroom/nestjs-libraries/services/ai-wallet-pricing';
const fixtureUrl = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixtureUrl ? describe : describe.skip)('durable quotes in isolated PostgreSQL', () => {
  let db: PrismaClient, wallet: AiWalletService, org: string;
  const before = { BILLING_ENABLED: process.env.BILLING_ENABLED, AI_WALLET_ENABLED: process.env.AI_WALLET_ENABLED };
  const quote = (): PricingQuote => ({ policyVersion: PREPAID_AI_POLICY.version, rateVersion: 'synthetic-v1',
    provider: 'fixture', model: 'model', currency: 'usd', markupPercent: 20, requestFingerprint: 'a'.repeat(64),
    per: '1', rates: { input: '10', output: '20' }, limits: { input: '1000', output: '200' } });
  const usage = () => ({ provider: 'fixture', model: 'model', providerRequestId: randomUUID(), units: { input: 10n, output: 2n } });
  const reserve = (key = randomUUID(), q = quote()) => wallet.reserve(org, key, q.provider, q.model, quotedCharge(q), q);
  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ep_ai_wallet_test') throw Error('Isolated fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixtureUrl } } }); await db.$connect();
    wallet = new AiWalletService({ model: db } as any);
  });
  beforeEach(async () => {
    process.env.BILLING_ENABLED = 'true'; process.env.AI_WALLET_ENABLED = 'true';
    org = `quote-test-${randomUUID()}`; await db.organization.create({ data: { id: org, name: 'Synthetic quote fixture' } });
    await db.aiWallet.create({ data: { organizationId: org, balanceNanos: 10000000n } });
  });
  afterAll(async () => {
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await db?.$disconnect();
  });
  it('persists a quote and rejects changed rates, version, request or omitted snapshot on retry', async () => {
    const key = randomUUID(), q = quote(), r = await reserve(key, q);
    expect(r.quoteSnapshot).toEqual(q);
    for (const change of [{ rateVersion: 'v2' }, { requestFingerprint: 'b'.repeat(64) }, { rates: { input: '11', output: '15' } }]) {
      await expect(reserve(key, { ...q, ...change })).rejects.toThrow('different parameters');
    }
    await expect(wallet.reserve(org, key, q.provider, q.model, r.ceilingNanos)).rejects.toThrow('different parameters');
    await expect(wallet.reserve(org, randomUUID(), q.provider, q.model, 1n, q)).rejects.toThrow('does not match');
  });
  it('settles the stored quote with +20 percent once despite flags/rate configuration changes', async () => {
    const r = await reserve(), u = usage(); await wallet.dispatch(org, r.id);
    await wallet.markUnknown(org, r.id, u.providerRequestId);
    process.env.AI_WALLET_ENABLED = 'false';
    const result = await wallet.reconcileQuoted(org, r.id, u);
    expect(result).toMatchObject({ state: 'SETTLED', chargedNanos: 168n, usageSnapshot: { units: { input: '10', output: '2' } } });
    await wallet.reconcileQuoted(org, r.id);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
    expect(await db.aiWallet.findUnique({ where: { organizationId: org } })).toMatchObject({ balanceNanos: 9999832n, heldNanos: 0n });
    await expect(wallet.reconcileQuoted(org, r.id, { ...u, units: { input: 12n, output: 1n } })).rejects.toThrow('usage changed');
    await expect(wallet.reconcileQuoted('other-org', r.id, u)).rejects.toThrow('not found');
  });
  it('rejects fabricated direct charges and missing or wrong-model usage without releasing holds', async () => {
    const r = await reserve(), u = usage(); await wallet.dispatch(org, r.id);
    await expect(wallet.settle(org, r.id, 0n, u.providerRequestId)).rejects.toThrow('requires');
    await expect(wallet.settle(org, r.id, 1n, u.providerRequestId, u)).rejects.toThrow('requires');
    await expect(wallet.reconcileQuoted(org, r.id, { ...u, model: 'other' })).rejects.toThrow('does not match');
    await expect(wallet.reconcileQuoted(org, r.id)).rejects.toThrow('requires');
    expect(await db.aiWallet.findUnique({ where: { organizationId: org } })).toMatchObject({ heldNanos: r.ceilingNanos });
  });
  it('retains over-ceiling receipts for review and rejects changed later receipts', async () => {
    const r = await reserve(), u = { ...usage(), units: { input: 100000n, output: 0n } };
    await wallet.dispatch(org, r.id);
    expect(await wallet.reconcileQuoted(org, r.id, u)).toMatchObject({ state: 'UNKNOWN', reportedNanos: 1200000n });
    await wallet.reconcileQuoted(org, r.id);
    await expect(wallet.reconcileQuoted(org, r.id, { ...u, units: { input: 100001n, output: 0n } })).rejects.toThrow('usage changed');
    expect(await db.aiWallet.findUnique({ where: { organizationId: org } })).toMatchObject({ status: 'REVIEW', heldNanos: r.ceilingNanos });
  });
  it('single-dispatch gateway ignores legacy price callback for a persisted quote', async () => {
    const q = quote(), invoke = jest.fn(async () => usage()), gateway = new AiWalletDispatchService(wallet), key = randomUUID();
    const run = () => gateway.run(org, key, { provider: q.provider, model: q.model, ceilingNanos: quotedCharge(q), pricingQuote: q },
      invoke, r => r.providerRequestId, r => r, () => { throw Error('Unquoted price callback must not run'); });
    const results = await Promise.all([run(), run(), run()]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(results.find(r => r.result)?.reservation.chargedNanos).toBe(168n);
  });
});
