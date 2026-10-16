import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { MediaTranscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.repository';
import { PREPAID_AI_POLICY, PricingQuote, quotedCharge } from '@gitroom/nestjs-libraries/services/ai-wallet-pricing';
const fixtureUrl = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixtureUrl ? describe : describe.skip)('durable paid transcription result boundary', () => {
  let db: PrismaClient, wallet: AiWalletService, org: string, mediaId: string, job: string;
  const before = { BILLING_ENABLED: process.env.BILLING_ENABLED, AI_WALLET_ENABLED: process.env.AI_WALLET_ENABLED };
  const quote = (): PricingQuote => ({ policyVersion: PREPAID_AI_POLICY.version, rateVersion: 'synthetic-v1',
    provider: 'fixture', model: 'model', currency: 'usd', markupPercent: 20, requestFingerprint: 'a'.repeat(64),
    per: '1', rates: { inputText: '10', inputAudio: '10', outputText: '20' },
    limits: { inputText: '16000', inputAudio: '16000', outputText: '2000' } });
  const receipt = () => ({ provider: 'fixture', model: 'model', providerRequestId: randomUUID(),
    units: { inputText: 0n, inputAudio: 10n, outputText: 2n } });
  const reserve = async () => {
    const q = quote(), r = await wallet.reserve(org, `media-transcription:${job}`, q.provider, q.model, quotedCharge(q), q);
    await wallet.dispatch(org, r.id); return r;
  };
  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ep_ai_wallet_test') throw Error('Isolated fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixtureUrl } } }); await db.$connect();
    wallet = new AiWalletService({ model: db } as any);
  });
  beforeEach(async () => {
    process.env.BILLING_ENABLED = 'true'; process.env.AI_WALLET_ENABLED = 'true';
    org = `transcription-test-${randomUUID()}`; mediaId = randomUUID(); job = randomUUID();
    await db.organization.create({ data: { id: org, name: 'Synthetic transcription fixture' } });
    await db.aiWallet.create({ data: { organizationId: org, balanceNanos: 10000000n } });
    await db.media.create({ data: { id: mediaId, name: 'synthetic.mp4', path: '/offline/synthetic.mp4', organizationId: org } });
    await db.mediaTranscription.create({ data: { id: job, mediaId, generation: 1, status: 'PROCESSING' } });
  });
  afterAll(async () => {
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await db?.$disconnect();
  });
  it.each(['Synthetic staged transcript', ''])('recovers a crash after staging and atomically debits/marks READY once: %p', async text => {
    const r = await reserve(), u = receipt();
    await wallet.stageTranscription(org, r.id, job, 1, text, u);
    expect(await db.mediaTranscription.findUnique({ where: { id: job } })).toMatchObject({ status: 'PROCESSING', text });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    wallet = new AiWalletService({ model: db } as any); // Simulate a new worker/process after the stage commit.
    process.env.AI_WALLET_ENABLED = 'false';
    await Promise.all([wallet.finishTranscription(org, r.id, job, 1), wallet.finishTranscription(org, r.id, job, 1)]);
    expect(await db.mediaTranscription.findUnique({ where: { id: job } })).toMatchObject({ status: 'READY', text: text || null });
    expect(await db.aiWallet.findUnique({ where: { organizationId: org } })).toMatchObject({ balanceNanos: 9999832n, heldNanos: 0n });
    const reservation = await wallet.quotedOperation(org, `media-transcription:${job}`);
    expect(reservation?.state).toBe('SETTLED'); expect(JSON.stringify(reservation?.usageSnapshot)).not.toContain('transcript');
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
  });
  it('rejects text corruption after the staging commit before any debit', async () => {
    const r = await reserve(); await wallet.stageTranscription(org, r.id, job, 1, 'original', receipt());
    await db.mediaTranscription.update({ where: { id: job }, data: { text: 'corrupted' } });
    await expect(wallet.finishTranscription(org, r.id, job, 1)).rejects.toThrow('integrity');
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
  });
  it('preserves staged output after lease expiry and blocks explicit retry generation reset', async () => {
    const r = await reserve(); await wallet.stageTranscription(org, r.id, job, 1, 'recoverable', receipt());
    await db.mediaTranscription.update({ where: { id: job }, data: { startedAt: new Date(0) } });
    const repository = new MediaTranscriptionRepository(db as any);
    expect(await repository.ensurePendingForActiveMedia(org, mediaId)).toMatchObject({ generation: 1, text: 'recoverable' });
    await db.mediaTranscription.update({ where: { id: job }, data: { status: 'FAILED' } });
    expect(await repository.retryFailedForActiveMedia(org, mediaId)).toMatchObject({ generation: 1, text: 'recoverable', status: 'FAILED' });
    await db.mediaTranscription.update({ where: { id: job }, data: { status: 'PROCESSING' } });
    expect((await wallet.finishTranscription(org, r.id, job, 1)).state).toBe('SETTLED');
  });

  it('holds an ambiguous dispatch without a staged result; a new generation cannot reserve a new operation', async () => {
    const r = await reserve(); await wallet.markUnknown(org, r.id);
    await expect(wallet.finishTranscription(org, r.id, job, 1)).rejects.toThrow('no staged');
    await db.mediaTranscription.update({ where: { id: job }, data: { generation: 2 } });
    const q = { ...quote(), requestFingerprint: 'b'.repeat(64) };
    await expect(wallet.reserve(org, `media-transcription:${job}`, q.provider, q.model, quotedCharge(q), q)).rejects.toThrow('different');
    expect((await wallet.dispatch(org, r.id)).dispatch).toBe(false);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
  });
  it('rolls back receipt staging for deleted/stale/unowned jobs and mismatched receipt identity', async () => {
    const r = await reserve(), u = receipt();
    await expect(wallet.stageTranscription('other-org', r.id, job, 1, 'text', u)).rejects.toThrow('not found');
    await expect(wallet.stageTranscription(org, r.id, job, 2, 'text', u)).rejects.toThrow('no longer');
    await expect(wallet.stageTranscription(org, r.id, job, 1, 'text', { ...u, model: 'other' })).rejects.toThrow('does not match');
    await db.media.update({ where: { id: mediaId }, data: { deletedAt: new Date() } });
    await expect(wallet.stageTranscription(org, r.id, job, 1, 'text', u)).rejects.toThrow('no longer');
    expect(await db.aiWalletReservation.findUnique({ where: { id: r.id } })).toMatchObject({ state: 'DISPATCHED', usageSnapshot: null });
    expect(await db.mediaTranscription.findUnique({ where: { id: job } })).toMatchObject({ text: null });
  });
  it('rejects changed staged text/usage and cannot debit after the active generation changes', async () => {
    const r = await reserve(), u = receipt(); await wallet.stageTranscription(org, r.id, job, 1, 'first', u);
    await expect(wallet.stageTranscription(org, r.id, job, 1, 'changed', u)).rejects.toThrow('changed');
    await expect(wallet.stageTranscription(org, r.id, job, 1, 'first', { ...u, providerRequestId: 'changed' })).rejects.toThrow('changed');
    await db.mediaTranscription.update({ where: { id: job }, data: { generation: 2 } });
    await expect(wallet.finishTranscription(org, r.id, job, 1)).rejects.toThrow('no longer');
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
  });
  it('keeps over-ceiling receipts held and staged without making output READY', async () => {
    const r = await reserve(), u = { ...receipt(), units: { inputText: 0n, inputAudio: 1000000n, outputText: 0n } };
    await wallet.stageTranscription(org, r.id, job, 1, 'staged', u);
    expect((await wallet.finishTranscription(org, r.id, job, 1)).state).toBe('UNKNOWN');
    expect(await db.aiWallet.findUnique({ where: { organizationId: org } })).toMatchObject({ status: 'REVIEW', heldNanos: r.ceilingNanos });
    expect(await db.mediaTranscription.findUnique({ where: { id: job } })).toMatchObject({ status: 'PROCESSING' });
  });
});
