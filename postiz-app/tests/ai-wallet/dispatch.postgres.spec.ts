import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletDispatchService } from '@gitroom/nestjs-libraries/services/ai-wallet-dispatch.service';
import { normalizeOpenAiTokens, normalizeOpenAiMedia, priceUsage } from '@gitroom/nestjs-libraries/services/ai-wallet-usage';

const fixtureUrl = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixtureUrl ? describe : describe.skip)('single-dispatch accounting against isolated PostgreSQL', () => {
  let db: PrismaClient, wallet: AiWalletService, gateway: AiWalletDispatchService, org: string;
  const prior = { BILLING_ENABLED: process.env.BILLING_ENABLED, AI_WALLET_ENABLED: process.env.AI_WALLET_ENABLED };
  const quote = { provider: 'openai', model: 'fixture-model', ceilingNanos: 5000000n };
  const rates = { units: { inputUncached: 1000n, inputCached: 500n, output: 2000n }, per: 1n };
  const receipt = () => ({ id: `receipt_${randomUUID()}`, model: quote.model, choices: [{ finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000, prompt_tokens_details: { cached_tokens: 0 } } });
  const measure = (r: any) => normalizeOpenAiTokens('chat', r);
  const price = (u: any) => priceUsage(u, rates);
  const state = () => db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } });
  const run = (invoke: () => Promise<any>, key = randomUUID(), q = quote) => gateway.run(org, key, q, invoke, (r) => r?.id, measure, price);
  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ep_ai_wallet_test') throw Error('Isolated fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixtureUrl } } }); await db.$connect();
    wallet = new AiWalletService({ model: db } as any); gateway = new AiWalletDispatchService(wallet);
  });
  beforeEach(async () => {
    wallet = new AiWalletService({ model: db } as any); gateway = new AiWalletDispatchService(wallet);
    process.env.BILLING_ENABLED = 'true'; process.env.AI_WALLET_ENABLED = 'true';
    org = `dispatch-test-${randomUUID()}`; await db.organization.create({ data: { id: org, name: 'Synthetic usage fixture' } });
    const t = await wallet.createTopup(org, randomUUID(), 'cus_synthetic', 1);
    await wallet.bindTopupSession(org, t.id, `cs_${t.id}`);
    await wallet.applyVerifiedTopupEvent({ eventId: `evt_${t.id}`, organizationId: org, topupId: t.id,
      sessionId: `cs_${t.id}`, paymentId: `pi_${t.id}`, customerId: t.customerId,
      amountCents: 1, currency: 'usd', mode: 'payment', paymentStatus: 'paid' });
  });
  afterAll(async () => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db?.$disconnect();
  });
  it('settles authoritative normalized usage once across concurrent operation retries', async () => {
    const invoke = jest.fn(async () => receipt()); const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => run(invoke, key)));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.result)).toHaveLength(1);
    expect(await state()).toMatchObject({ balanceNanos: 7000000n, heldNanos: 0n });
    await run(invoke, key); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('blocks exhausted balance and disabled billing before any provider invocation', async () => {
    const invoke = jest.fn(async () => receipt());
    await expect(run(invoke, randomUUID(), { ...quote, ceilingNanos: 11000000n })).rejects.toThrow('Insufficient');
    process.env.AI_WALLET_ENABLED = 'false'; await expect(run(invoke)).rejects.toThrow('disabled');
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(['timeout', 'usage', 'model'])('holds ambiguous %s and never dispatches a retry', async (failure) => {
    const raw = receipt();
    const invoke = jest.fn(async () => {
      if (failure === 'timeout') throw Error('synthetic connection lost after acceptance');
      return { ...raw, ...(failure === 'usage' ? { usage: null } : { model: 'unquoted-fallback-model' }) };
    });
    const key = randomUUID(); const result = await run(invoke, key);
    expect(result.reservation.state).toBe('UNKNOWN'); expect(result.result).toBeUndefined();
    expect(result.reservation.providerRequestId).toBe(failure === 'timeout' ? null : raw.id);
    expect(await state()).toMatchObject({ balanceNanos: 10000000n, heldNanos: 5000000n });
    gateway = new AiWalletDispatchService(new AiWalletService({ model: db } as any));
    await run(invoke, key); expect(invoke).toHaveBeenCalledTimes(1);
    await expect(wallet.cancelBeforeDispatch(org, result.reservation.id)).rejects.toThrow('receipt');
  });
  it('retains holds when settlement fails and safely reconciles the same receipt later', async () => {
    const raw = receipt(); const settle = jest.spyOn(wallet, 'settle').mockRejectedValueOnce(Error('synthetic DB failure'));
    const result = await run(async () => raw); settle.mockRestore();
    expect(result.reservation.state).toBe('UNKNOWN');
    process.env.BILLING_ENABLED = 'false'; process.env.AI_WALLET_ENABLED = 'false';
    await wallet.settle(org, result.reservation.id, price(measure(raw)), raw.id);
    expect(await state()).toMatchObject({ balanceNanos: 7000000n, heldNanos: 0n });
  });
  it('freezes above-ceiling usage without returning an unaccounted result', async () => {
    const result = await run(async () => ({ ...receipt(), usage: { prompt_tokens: 10000, completion_tokens: 0,
      total_tokens: 10000, prompt_tokens_details: { cached_tokens: 0 } } }));
    expect(result.result).toBeUndefined(); expect(result.reservation.state).toBe('UNKNOWN');
    expect(await state()).toMatchObject({ status: 'REVIEW', balanceNanos: 10000000n, heldNanos: 5000000n });
  });
  it('cannot reconcile another tenant or reuse a provider receipt in another operation', async () => {
    const raw = receipt(); const result = await run(async () => raw);
    await expect(wallet.settle('other-tenant', result.reservation.id, 0n, raw.id)).rejects.toThrow('not found');
    const duplicate = await run(async () => raw);
    expect(duplicate.reservation.state).toBe('UNKNOWN');
    expect(await state()).toMatchObject({ balanceNanos: 7000000n, heldNanos: 5000000n });
  });
  it('persists an async task identity and prevents redispatch after restart', async () => {
    const task = `task_${randomUUID()}`, key = randomUUID();
    const invoke = jest.fn(async () => ({ task }));
    const pending = () => ({ provider: 'kie', model: 'fixture-video', providerRequestId: task, pending: true as const });
    const q = { ...quote, provider: 'kie', model: 'fixture-video' };
    const result = await gateway.run(org, key, q, invoke, (r) => r.task, pending, price);
    expect(result.reservation).toMatchObject({ state: 'UNKNOWN', providerRequestId: task });
    gateway = new AiWalletDispatchService(new AiWalletService({ model: db } as any));
    await gateway.run(org, key, q, invoke, (r) => r.task, pending, price);
    expect(invoke).toHaveBeenCalledTimes(1);
    await wallet.settle(org, result.reservation.id, 2000000n, task);
    expect(await state()).toMatchObject({ balanceNanos: 8000000n, heldNanos: 0n });
  });
  it('keeps paid child cost when a sibling is never dispatched or parent falls back locally', async () => {
    const parent = randomUUID();
    const paidChild = await run(async () => receipt(), `${parent}:draft`);
    const undispatched = await wallet.reserve(org, `${parent}:image`, quote.provider, quote.model, quote.ceilingNanos);
    await wallet.cancelBeforeDispatch(org, undispatched.id);
    expect(paidChild.reservation.state).toBe('SETTLED');
    expect(await state()).toMatchObject({ balanceNanos: 7000000n, heldNanos: 0n });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'USAGE' } })).toBe(1);
  });
  it('settles server completion even when a client abandons waiting', async () => {
    let finish!: (value: any) => void;
    const pending = run(() => new Promise((resolve) => { finish = resolve; }));
    for (let i = 0; !finish && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(finish).toBeDefined(); finish(receipt()); await pending;
    expect(await state()).toMatchObject({ balanceNanos: 7000000n, heldNanos: 0n });
  });
});
