import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
const mockSubscriptions = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  subscriptions: { list: (...args: any[]) => mockSubscriptions(...args) },
})) }));
jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletTextService, TEXT_OUTPUT_TOKENS } from '@gitroom/nestjs-libraries/services/ai-wallet-text.service';
const fixture = process.env.AI_WALLET_TEST_DATABASE_URL;
const request = { model: 'gpt-6-luna', reasoning_effort: 'none', messages: [{ role: 'user', content: 'Synthetic facts' }],
  response_format: { type: 'json_schema', json_schema: { name: 'fixture', strict: true, schema: { type: 'object' } } } };
const response = () => ({ id: randomUUID(), model: request.model, service_tier: 'default',
  choices: [{ finish_reason: 'stop', message: { parsed: { draft: 'Synthetic draft' } } }],
  usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13,
    prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 1 } } });
(fixture ? describe : describe.skip)('durable bounded text adapter with offline provider', () => {
  let db: PrismaClient, wallet: AiWalletService, adapter: AiWalletTextService, org: string, key: string, invoke: jest.Mock;
  const env = { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true', AI_WALLET_TEXT_ENABLED: 'true',
    AI_WALLET_TEXT_RATE_CARDS: JSON.stringify({ [request.model]: { billingContext: 'standard-text-receipt-no-extra-charges',
      rateVersion: 'synthetic-v1', per: '1', rates: { inputUncachedLow: '2', inputCachedLow: '1', outputLow: '5',
        inputUncachedHigh: '4', inputCachedHigh: '2', outputHigh: '8' } } }) };
  const before = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  const run = (body = request, allow = true) => adapter.run(org, key, 'a'.repeat(64), body, allow, invoke);
  beforeAll(async () => {
    const u = new URL(fixture!);
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.pathname !== '/ep_ai_wallet_test') throw Error('Disposable fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixture } } }); await db.$connect();
  });
  beforeEach(async () => {
    Object.assign(process.env, env); wallet = new AiWalletService({ model: db } as any); adapter = new AiWalletTextService(wallet);
    org = randomUUID(); key = `guided-text:${randomUUID()}:summary`;
    await db.organization.create({ data: { id: org, name: 'Synthetic text fixture', paymentId: `cus_${org}`, allowTrial: false,
      subscription: { create: { subscriptionTier: 'LAUNCH_V1', totalChannels: 0, period: 'MONTHLY' } } } });
    await db.aiWallet.create({ data: { organizationId: org, balanceNanos: 100000000n } });
    invoke = jest.fn(async () => response());
  });
  afterAll(async () => { for (const [k,v] of Object.entries(before)) v === undefined ? delete process.env[k] : process.env[k] = v; await db?.$disconnect(); });
  const reconcile = async (status: string) => {
    const repository = { model: db } as any;
    const subscriptions = new SubscriptionRepository(repository, repository, repository, repository, repository);
    const service = new SubscriptionService(subscriptions, { getIntegrationsList: async () => [], changeActiveCron: jest.fn(),
      restoreActiveCron: jest.fn() } as any, { enforceSingleEnabledOwner: jest.fn(), disableOrEnableNonSuperAdminUsers: jest.fn() } as any, repository);
    const stripe = new StripeService(service, {} as any, {} as any, {} as any);
    jest.spyOn(stripe, 'checkValidCard').mockResolvedValue(true);
    const event = { data: { object: { id: `sub_${org}`, customer: `cus_${org}`, status, cancel_at: 2000000000,
      metadata: { service: 'gitroom', billing: 'LAUNCH_V1', period: 'MONTHLY', uniqueId: `sub_${org}` },
      items: { data: [{ quantity: 1, price: { currency: 'usd', type: 'recurring', unit_amount: 900,
        recurring: { interval: 'month', interval_count: 1 }, billing_scheme: 'per_unit',
        lookup_key: 'everywhereposter_launch_v1_monthly', metadata: { plan_version: 'LAUNCH_V1' } } }] },
    } } } as any;
    mockSubscriptions.mockResolvedValue({ data: [event.data.object], has_more: false });
    if (status === 'canceled') await stripe.deleteSubscription(event); else await stripe.updateSubscription(event);
    return subscriptions.getSubscription(org);
  };
  const reserveBeforeInterruption = async () => {
    const claim = jest.spyOn(wallet, 'dispatch').mockRejectedValueOnce(Error('interrupted before claim'));
    await expect(run()).rejects.toThrow('interrupted before claim'); claim.mockRestore();
    expect(await wallet.quotedOperation(org, key)).toMatchObject({ state: 'RESERVED' });
  };
  it.each(['unpaid', 'paused', 'canceled', 'incomplete_expired'])('blocks undispatched reservations after %s, then recovers exactly once', async status => {
    await reserveBeforeInterruption();
    const held = (await db.aiWallet.findUnique({ where: { organizationId: org } }))!.heldNanos;
    expect(await reconcile(status)).toBeNull();
    await expect(run(request, false)).rejects.toThrow();
    // A stale caller grant must not bypass current persisted entitlements.
    await expect(run()).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect(await wallet.quotedOperation(org, key)).toMatchObject({ state: 'RESERVED' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    expect((await db.aiWallet.findUnique({ where: { organizationId: org } }))!.heldNanos).toBe(held);
    await reconcile('active'); await Promise.allSettled([run(), run()]); await run(request, false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
    expect(await wallet.quotedOperation(org, key)).toMatchObject({ state: 'SETTLED', chargedNanos: 40n });
  });
  it.each(['active', 'trialing', 'past_due'])('preserves %s execution and cancellation-at-period-end', async status => {
    expect(await reconcile(status)).toMatchObject({ subscriptionTier: 'LAUNCH_V1', cancelAt: new Date(2000000000000) });
    await run(); await run(request, false); expect(invoke).toHaveBeenCalledTimes(1);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
  });
  it('rechecks entitlement if revocation commits after reservation but before dispatch', async () => {
    const dispatch = wallet.dispatch.bind(wallet);
    jest.spyOn(wallet, 'dispatch').mockImplementationOnce(async (...args) => { await reconcile('unpaid'); return dispatch(...args); });
    await expect(run()).rejects.toThrow(); expect(invoke).not.toHaveBeenCalled();
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
  });
  it('reads fresh entitlement after waiting for a concurrent revocation transaction', async () => {
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    const revoke = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${org}, 2))::text`;
      await tx.subscription.delete({ where: { organizationId: org } }); entered(); await hold;
    });
    await ready;
    const execution = run().then(() => undefined, error => error);
    try { await new Promise(resolve => setTimeout(resolve, 30)); expect(invoke).not.toHaveBeenCalled(); }
    finally { release(); await revoke; }
    expect(await execution).toBeInstanceOf(Error); expect(invoke).not.toHaveBeenCalled();
  });
  it('settles a staged result after revocation without redispatch or duplicate debit', async () => {
    jest.spyOn(wallet, 'finishText').mockRejectedValueOnce(Error('synthetic commit failure'));
    await expect(run()).rejects.toThrow('commit failure'); await reconcile('unpaid');
    process.env.BILLING_ENABLED = process.env.AI_WALLET_ENABLED = process.env.AI_WALLET_TEXT_ENABLED = 'false';
    await run(request, false); await run(request, false); expect(invoke).toHaveBeenCalledTimes(1);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
    expect(await wallet.quotedOperation(org, key)).toMatchObject({ state: 'SETTLED', chargedNanos: 40n });
  });
  it.each(['BILLING_ENABLED', 'AI_WALLET_ENABLED', 'AI_WALLET_TEXT_ENABLED'])('does not dispatch a held reservation after %s is paused', async flag => {
    await reserveBeforeInterruption(); process.env[flag] = 'false';
    await expect(run()).rejects.toThrow('disabled'); expect(invoke).not.toHaveBeenCalled();
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
  });
  it('rejects a fresh execution with a stale caller grant after revocation', async () => {
    await reconcile('unpaid'); await expect(run()).rejects.toThrow('not included');
    expect(invoke).not.toHaveBeenCalled();
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
  });
  it('concurrent attempts claim once, persist output, charge +20 percent once and replay after flags pause', async () => {
    await Promise.allSettled([run(), run(), run()]); expect(invoke).toHaveBeenCalledTimes(1);
    process.env.AI_WALLET_TEXT_ENABLED = 'false'; process.env.AI_WALLET_ENABLED = 'false';
    expect(await run(request, false)).toEqual({ choices: [{ message: { parsed: { draft: 'Synthetic draft' } } }] });
    const row = await wallet.quotedOperation(org, key);
    expect(row).toMatchObject({ state: 'SETTLED', chargedNanos: 40n }); // ceil((8*2+2*1+3*5)*1.2)
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ max_completion_tokens: TEXT_OUTPUT_TOKENS, n: 1, service_tier: 'default' }));
  });
  it('resumes a staged result after local settlement failure without dispatching again', async () => {
    jest.spyOn(wallet, 'finishText').mockRejectedValueOnce(Error('synthetic commit failure'));
    await expect(run()).rejects.toThrow('commit failure');
    wallet = new AiWalletService({ model: db } as any); adapter = new AiWalletTextService(wallet);
    expect(await run()).toHaveProperty('choices'); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['timeout','usage','model','tier','cache-write','tool'])('retains the hold after ambiguous or unsupported %s without retry', async kind => {
    invoke.mockImplementation(async () => { const r: any = response();
      if (kind === 'timeout') throw Error('timeout'); if (kind === 'usage') delete r.usage;
      if (kind === 'model') r.model = 'different'; if (kind === 'tier') r.service_tier = 'priority';
      if (kind === 'cache-write') r.usage.prompt_tokens_details.cache_write_tokens = 1;
      if (kind === 'tool') r.choices[0].message.tool_calls = [{}]; return r;
    });
    await expect(run()).rejects.toThrow('reconciliation'); await expect(run()).rejects.toThrow('reconciliation');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await wallet.quotedOperation(org,key)).toMatchObject({ state: 'UNKNOWN' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    expect((await db.aiWallet.findUnique({ where: { organizationId: org } }))!.heldNanos).toBeGreaterThan(0n);
  });
  it('rejects missing rates, oversized/media requests and insufficient funds before provider dispatch', async () => {
    delete process.env.AI_WALLET_TEXT_RATE_CARDS; await expect(run()).rejects.toThrow('rate card'); Object.assign(process.env,env);
    await expect(run({ ...request, messages: [{ role: 'user', content: 'x'.repeat(32769) }] })).rejects.toThrow('oversized');
    await expect(run({ ...request, messages: [{ role: 'user', content: [] as any }] })).rejects.toThrow('Unsupported');
    await db.aiWallet.update({ where: { organizationId: org }, data: { balanceNanos: 0n } });
    await expect(run()).rejects.toThrow('Insufficient'); expect(invoke).not.toHaveBeenCalled();
  });
  it('binds inputs and tenant identity and rejects tampered output on replay', async () => {
    await run(); await expect(run({ ...request, messages: [{ role: 'user', content: 'Changed facts' }] })).rejects.toThrow('different inputs');
    const row = (await wallet.quotedOperation(org,key))!;
    await expect(wallet.finishText('different-org',row.id)).rejects.toThrow('not found');
    await db.aiTextResult.update({ where: { reservationId: row.id }, data: { output: { forged: true } } });
    await expect(run()).rejects.toThrow('integrity'); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('prices high-context receipts using the configured high tier rather than low-context rates', async () => {
    invoke.mockImplementation(async () => ({ ...response(), usage: { prompt_tokens: 272001, completion_tokens: 3, total_tokens: 272004,
      prompt_tokens_details: { cached_tokens: 1 }, completion_tokens_details: { reasoning_tokens: 1 } } }));
    await run(); expect(await wallet.quotedOperation(org,key)).toMatchObject({ chargedNanos: 1305632n });
  });
});
