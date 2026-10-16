import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { MediaTranscriptionService } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.service';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletTranscriptionService } from '@gitroom/nestjs-libraries/services/ai-wallet-transcription.service';
const fixtureUrl = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixtureUrl ? describe : describe.skip)('default-off actual transcription adapter with offline provider fixture', () => {
  let db: PrismaClient, wallet: AiWalletService, adapter: AiWalletTranscriptionService, org: string, job: string, mediaId: string;
  let model: any, prepare: jest.Mock;
  const env = { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true', AI_WALLET_TRANSCRIPTION_ENABLED: 'true',
    AI_WALLET_TRANSCRIPTION_RATE_CARD: JSON.stringify({ rateVersion: 'synthetic-v1', per: '1',
      rates: { inputText: '10', inputAudio: '10', outputText: '20' } }) };
  const before = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  const response = () => ({ request_id: randomUUID(), data: { text: ' Synthetic transcript. ', usage: { type: 'tokens',
    input_tokens: 10, output_tokens: 2, total_tokens: 12, input_token_details: { text_tokens: 0, audio_tokens: 10 } } } });
  const run = () => adapter.run(org, job, 1, prepare);
  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ep_ai_wallet_test') throw Error('Isolated fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixtureUrl } } }); await db.$connect();
  });
  beforeEach(async () => {
    Object.assign(process.env, env); wallet = new AiWalletService({ model: db } as any);
    model = { transcribePrepaidAudio: jest.fn(async () => response()) }; adapter = new AiWalletTranscriptionService(wallet, model);
    prepare = jest.fn(async () => ({ file: {} as any, audioSha256: 'a'.repeat(64) }));
    org = `adapter-test-${randomUUID()}`; job = randomUUID(); mediaId = randomUUID();
    await db.organization.create({ data: { id: org, name: 'Synthetic adapter fixture' } });
    await db.aiWallet.create({ data: { organizationId: org, balanceNanos: 10000000n } });
    await db.media.create({ data: { id: mediaId, organizationId: org, name: 'fixture.mp4', path: '/offline/fixture.mp4' } });
    await db.mediaTranscription.create({ data: { id: job, mediaId, status: 'PROCESSING' } });
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await db?.$disconnect();
  });
  it('routes the real media lifecycle through accounting before any legacy paid method', async () => {
    const lifecycleModel = { transcribeVideo: jest.fn() }, accounted = { run: jest.fn(async () => ({ state: 'UNKNOWN' })) };
    const repository = { claimForProcessing: jest.fn(), getActiveWorkerInput: jest.fn(async () => ({
      media: { organizationId: org, path: '/offline/fixture.mp4', name: 'fixture.mp4' },
    })) };
    const lifecycle = new MediaTranscriptionService(repository as any, {} as any, lifecycleModel as any, accounted as any);
    expect(await lifecycle.processTranscription(job, 1)).toMatchObject({ status: 'PROCESSING' });
    expect(accounted.run).toHaveBeenCalledWith(org, job, 1, expect.any(Function));
    expect(lifecycleModel.transcribeVideo).not.toHaveBeenCalled();
  });

  it('preserves flags-off legacy and fails closed when adapter/rates/balance are unavailable', async () => {
    process.env.AI_WALLET_ENABLED = 'false'; expect(await run()).toBeUndefined();
    process.env.AI_WALLET_ENABLED = 'true'; process.env.AI_WALLET_TRANSCRIPTION_ENABLED = 'false';
    await expect(run()).rejects.toThrow('disabled');
    process.env.AI_WALLET_TRANSCRIPTION_ENABLED = 'true'; delete process.env.AI_WALLET_TRANSCRIPTION_RATE_CARD;
    await expect(run()).rejects.toThrow('rate card');
    expect(prepare).not.toHaveBeenCalled(); expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
    Object.assign(process.env, env); await db.aiWallet.update({ where: { organizationId: org }, data: { balanceNanos: 0n } });
    await expect(run()).rejects.toThrow('Insufficient'); expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
  });
  it('dispatches once concurrently, stores the approved quote, and exposes READY with one +20 percent debit', async () => {
    await Promise.all([run(), run(), run()]); await run();
    expect(model.transcribePrepaidAudio).toHaveBeenCalledTimes(1);
    const r = await wallet.quotedOperation(org, `media-transcription:${job}`);
    expect(r).toMatchObject({ state: 'SETTLED', chargedNanos: 168n,
      quoteSnapshot: { markupPercent: 20, limits: { inputText: '16000', inputAudio: '16000', outputText: '2000' } } });
    expect(await db.mediaTranscription.findUnique({ where: { id: job } })).toMatchObject({ status: 'READY', text: 'Synthetic transcript.' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
  });
  it('recovers a crash after receipt staging without another paid call, even after flags pause', async () => {
    jest.spyOn(wallet, 'finishTranscription').mockRejectedValueOnce(Error('synthetic local commit failure'));
    await expect(run()).rejects.toThrow('commit failure');
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    wallet = new AiWalletService({ model: db } as any); adapter = new AiWalletTranscriptionService(wallet, model);
    process.env.AI_WALLET_ENABLED = 'false'; process.env.AI_WALLET_TRANSCRIPTION_ENABLED = 'false';
    expect((await run())?.state).toBe('SETTLED'); expect(model.transcribePrepaidAudio).toHaveBeenCalledTimes(1);
  });
  it.each(['timeout', 'usage', 'identity'])('keeps ambiguous %s held and never falls through to legacy/retries', async failure => {
    model.transcribePrepaidAudio.mockImplementation(async () => {
      if (failure === 'timeout') throw Error('synthetic post-acceptance connection loss');
      const r = response(); return failure === 'usage' ? { ...r, data: { text: 'text' } } : { ...r, request_id: null };
    });
    expect((await run())?.state).toBe('UNKNOWN'); process.env.AI_WALLET_ENABLED = 'false';
    expect((await run())?.state).toBe('UNKNOWN'); expect(model.transcribePrepaidAudio).toHaveBeenCalledTimes(1);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    expect((await db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } })).heldNanos).toBeGreaterThan(0n);
  });
  it('checks active generation and deletion again immediately before dispatch', async () => {
    prepare.mockImplementation(async () => {
      await db.media.update({ where: { id: mediaId }, data: { deletedAt: new Date() } });
      return { file: {} as any, audioSha256: 'a'.repeat(64) };
    });
    await expect(run()).rejects.toThrow('no longer active'); expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
  });
});
