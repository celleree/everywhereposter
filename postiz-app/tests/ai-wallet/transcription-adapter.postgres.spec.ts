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
import { MediaTranscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.repository';
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
  const run = (allowNewReservation = true) => adapter.run(org, job, 1, allowNewReservation, prepare);
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
    await db.organization.create({ data: { id: org, name: 'Synthetic adapter fixture', paymentId: `cus_${org}`, allowTrial: false,
      subscription: { create: { subscriptionTier: 'LAUNCH_V1', totalChannels: 0, period: 'MONTHLY' } } } });
    await db.aiWallet.create({ data: { organizationId: org, balanceNanos: 10000000n } });
    await db.media.create({ data: { id: mediaId, organizationId: org, name: 'fixture.mp4', path: '/offline/fixture.mp4' } });
    await db.mediaTranscription.create({ data: { id: job, mediaId, status: 'PROCESSING' } });
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await db?.$disconnect();
  });
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
    const claim = jest.spyOn(wallet, 'dispatchTranscription').mockRejectedValueOnce(Error('interrupted before claim'));
    await expect(run()).rejects.toThrow('interrupted before claim'); claim.mockRestore();
    expect(await wallet.quotedOperation(org, `media-transcription:${job}`)).toMatchObject({ state: 'RESERVED' });
  };
  it('routes the real media lifecycle through accounting before any legacy paid method', async () => {
    const lifecycleModel = { transcribeVideo: jest.fn() }, accounted = { run: jest.fn(async () => ({ state: 'UNKNOWN' })) };
    const repository = { claimForProcessing: jest.fn(), getActiveWorkerInput: jest.fn(async () => ({
      media: { organizationId: org, path: '/offline/fixture.mp4', name: 'fixture.mp4',
        organization: { subscription: { subscriptionTier: 'LAUNCH_V1' } } },
    })) };
    const lifecycle = new MediaTranscriptionService(repository as any, {} as any, lifecycleModel as any, accounted as any);
    expect(await lifecycle.processTranscription(job, 1)).toMatchObject({ status: 'PROCESSING' });
    expect(accounted.run).toHaveBeenCalledWith(org, job, 1, true, expect.any(Function));
    expect(lifecycleModel.transcribeVideo).not.toHaveBeenCalled();
  });

  it('preserves flags-off legacy and fails closed when adapter/rates/balance are unavailable', async () => {
    process.env.AI_WALLET_ENABLED = 'false'; expect(await run(false)).toBeUndefined();
    await expect(run()).rejects.toThrow('disabled');
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
  it.each(['BILLING_ENABLED', 'AI_WALLET_ENABLED', 'AI_WALLET_TRANSCRIPTION_ENABLED'])('denies a held reservation after %s is paused', async flag => {
    await reserveBeforeInterruption();
    process.env[flag] = 'false';
    await expect(run()).rejects.toThrow('disabled');
    expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
  });

  it.each(['unpaid', 'paused', 'canceled', 'incomplete_expired'])('denies held and fresh execution after %s, then restores once', async status => {
    await reserveBeforeInterruption();
    const held = (await db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } })).heldNanos;
    expect(await reconcile(status)).toBeNull();
    await expect(run(false)).rejects.toThrow('disabled');
    await expect(run()).rejects.toThrow('not included'); // Stale caller authorization.
    expect(await wallet.quotedOperation(org, `media-transcription:${job}`)).toMatchObject({ state: 'RESERVED' });
    expect((await db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } })).heldNanos).toBe(held);
    expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    // A new generation/job with no existing reservation also cannot use a stale grant.
    const originalJob = job; job = randomUUID();
    await db.mediaTranscription.create({ data: { id: job, mediaId: (await db.media.create({ data: {
      organizationId: org, name: 'second.mp4', path: '/offline/second.mp4' } })).id, status: 'PROCESSING' } });
    await expect(run()).rejects.toThrow('not included');
    expect(model.transcribePrepaidAudio).not.toHaveBeenCalled(); job = originalJob;
    await reconcile('active'); delete process.env.AI_WALLET_TRANSCRIPTION_RATE_CARD;
    await Promise.allSettled([run(), run()]); await run(false);
    expect(model.transcribePrepaidAudio).toHaveBeenCalledTimes(1);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
    expect(await wallet.quotedOperation(org, `media-transcription:${job}`)).toMatchObject({ state: 'SETTLED', chargedNanos: 168n });
  });
  it.each(['active', 'trialing', 'past_due'])('preserves %s and period-end cancellation', async status => {
    expect(await reconcile(status)).toMatchObject({ subscriptionTier: 'LAUNCH_V1', cancelAt: new Date(2000000000000) });
    await run(); await run(false); expect(model.transcribePrepaidAudio).toHaveBeenCalledTimes(1);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
  });
  it('rechecks authorization after preparation and immediately before claiming', async () => {
    prepare.mockImplementationOnce(async () => { await reconcile('unpaid'); return { file: {}, audioSha256: 'a'.repeat(64) }; });
    await expect(run()).rejects.toThrow('not included'); expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
  });
  it.each(['BILLING_ENABLED', 'AI_WALLET_ENABLED', 'AI_WALLET_TRANSCRIPTION_ENABLED'])('rechecks %s after preparation', async flag => {
    await reserveBeforeInterruption();
    prepare.mockImplementationOnce(async () => { process.env[flag] = 'false'; return { file: {}, audioSha256: 'a'.repeat(64) }; });
    await expect(run()).rejects.toThrow('disabled'); expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
  });
  it.each(['subscription', 'flag'])('rechecks %s after waiting on concurrent subscription reconciliation', async kind => {
    await reserveBeforeInterruption();
    let entered!: (pid: number) => void, release!: () => void;
    const ready = new Promise<number>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    const revoke = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${org}, 2))::text`;
      if (kind === 'subscription') await tx.subscription.delete({ where: { organizationId: org } });
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; entered(row.pid); await hold;
    });
    const pid = await ready;
    const execution = run().then(() => undefined, error => error);
    try {
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        const [row] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_locks blocked JOIN pg_locks held ON held.classid = blocked.classid AND held.objid = blocked.objid
          WHERE blocked.locktype = 'advisory' AND NOT blocked.granted AND held.locktype = 'advisory'
            AND held.granted AND held.pid = ${pid}) AS waiting`;
        waiting = row.waiting; if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true); expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
    } finally { if (kind === 'flag') process.env.AI_WALLET_TRANSCRIPTION_ENABLED = 'false'; release(); await revoke; }
    expect(await execution).toBeInstanceOf(Error); expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
  });
  it('preserves fingerprint, generation and tenant checks when an authorized hold resumes', async () => {
    await reserveBeforeInterruption();
    const reservation = (await wallet.quotedOperation(org, `media-transcription:${job}`))!;
    await expect(wallet.dispatchTranscription('other-org', reservation.id, job, 1)).rejects.toThrow('not found');
    await expect(adapter.run(org, job, 2, true, prepare)).rejects.toThrow('fingerprint');
    prepare.mockResolvedValueOnce({ file: {}, audioSha256: 'b'.repeat(64) });
    await expect(run()).rejects.toThrow('fingerprint');
    expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
    await run(); expect(model.transcribePrepaidAudio).toHaveBeenCalledTimes(1);
  });

  it('recovers a crash after receipt staging without another paid call, even after flags pause', async () => {
    jest.spyOn(wallet, 'finishTranscription').mockRejectedValueOnce(Error('synthetic local commit failure'));
    await expect(run()).rejects.toThrow('commit failure'); await reconcile('unpaid');
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    wallet = new AiWalletService({ model: db } as any); adapter = new AiWalletTranscriptionService(wallet, model);
    process.env.BILLING_ENABLED = process.env.AI_WALLET_ENABLED = process.env.AI_WALLET_TRANSCRIPTION_ENABLED = 'false';
    expect((await run(false))?.state).toBe('SETTLED'); await run(false); expect(model.transcribePrepaidAudio).toHaveBeenCalledTimes(1);
  });
  it('preserves staged output after all three local settlement failures and terminal workflow failure', async () => {
    const failure = jest.spyOn(wallet, 'finishTranscription').mockRejectedValue(Error('synthetic persistent DB failure'));
    for (let i = 0; i < 3; i++) await expect(run()).rejects.toThrow('DB failure');
    const repository = new MediaTranscriptionRepository(db as any);
    const lifecycle = new MediaTranscriptionService(repository, {} as any, model, adapter);
    await lifecycle.failTranscription(job, 1);
    expect(await repository.failIfActive(job, 1, 'FAILED', 'offline')).toBe(false);
    expect(await db.mediaTranscription.findUnique({ where: { id: job } })).toMatchObject({ status: 'PROCESSING', text: 'Synthetic transcript.' });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    failure.mockRestore();
    expect((await run())?.state).toBe('SETTLED'); expect(model.transcribePrepaidAudio).toHaveBeenCalledTimes(1);
  });
  it('still fails ordinary unpaid jobs through the existing workflow failure handler', async () => {
    const repository = new MediaTranscriptionRepository(db as any);
    expect(await repository.failIfPendingOrProcessing(job, 1, 'FAILED', 'offline')).toBe(true);
    expect(await db.mediaTranscription.findUnique({ where: { id: job } })).toMatchObject({ status: 'FAILED', text: null });
  });

  it.each(['timeout', 'usage', 'identity'])('keeps ambiguous %s held and never falls through to legacy/retries', async failure => {
    model.transcribePrepaidAudio.mockImplementation(async () => {
      if (failure === 'timeout') throw Error('synthetic post-acceptance connection loss');
      const r = response(); return failure === 'usage' ? { ...r, data: { text: 'text' } } : { ...r, request_id: null };
    });
    expect((await run())?.state).toBe('UNKNOWN'); await reconcile('unpaid'); process.env.AI_WALLET_ENABLED = 'false';
    expect((await run(false))?.state).toBe('UNKNOWN'); expect(model.transcribePrepaidAudio).toHaveBeenCalledTimes(1);
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
