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
    await db.organization.create({ data: { id: org, name: 'Synthetic text fixture' } });
    await db.aiWallet.create({ data: { organizationId: org, balanceNanos: 100000000n } });
    invoke = jest.fn(async () => response());
  });
  afterAll(async () => { for (const [k,v] of Object.entries(before)) v === undefined ? delete process.env[k] : process.env[k] = v; await db?.$disconnect(); });
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
