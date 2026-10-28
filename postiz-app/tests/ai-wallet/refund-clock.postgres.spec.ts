import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletRefundRequestService } from '@gitroom/nestjs-libraries/services/ai-wallet-refund-request.service';

const fixture = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixture ? describe : describe.skip)('refund terminal timestamps across an application clock step', () => {
  let db: PrismaClient, service: AiWalletRefundRequestService, org: string, topup: any, request: any;
  const original = { ...process.env };
  const event = (status = 'succeeded') => ({ id: `evt_${randomUUID()}`, object: 'event', livemode: false,
    type: 'refund.updated', data: { object: { id: `re_${topup.id}`, object: 'refund',
      payment_intent: `pi_${topup.id}`, charge: `ch_${topup.id}`, amount: 123, currency: 'usd', status } } } as any);
  const review = (target = service) => target.reviewTestTopup(org, request.id, 'platform-admin', {
    topupId: topup.id, refundId: `re_${topup.id}`, chargeId: `ch_${topup.id}` });
  beforeAll(async () => {
    const url = new URL(fixture!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/ep_ai_wallet_test' || url.username !== 'isolated')
      throw Error('Owned isolated wallet fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixture } } }); await db.$connect();
  });
  beforeEach(async () => {
    Object.assign(process.env, { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true',
      AI_WALLET_TEST_REFUNDS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_synthetic_not_a_credential' });
    org = randomUUID(); await db.organization.create({ data: { id: org, name: 'Synthetic refund clock regression' } });
    const wallet = new AiWalletService({ model: db } as any);
    service = new AiWalletRefundRequestService({ model: db } as any);
    topup = await wallet.createTopup(org, randomUUID(), 'cus_synthetic', 123);
    await wallet.bindTopupSession(org, topup.id, `cs_${topup.id}`);
    await wallet.applyVerifiedTopupEvent({ eventId: randomUUID(), organizationId: org, topupId: topup.id,
      sessionId: `cs_${topup.id}`, paymentId: `pi_${topup.id}`, customerId: topup.customerId,
      amountCents: 123, currency: 'usd', mode: 'payment', paymentStatus: 'paid' });
    request = await service.request(org, 'requester', randomUUID());
  });
  afterEach(() => jest.useRealTimers());
  afterAll(async () => { process.env = original; await db?.$disconnect(); });
  const money = async (refunded: boolean) => {
    expect(await db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } }))
      .toMatchObject({ balanceNanos: refunded ? 0n : 1230000000n, heldNanos: 0n });
    const reversals = await db.aiWalletLedger.findMany({ where: { organizationId: org, kind: 'REVERSAL' } });
    expect(reversals).toHaveLength(refunded ? 1 : 0);
    if (refunded) expect(reversals[0]).toMatchObject({ externalKey: `refund:re_${topup.id}`,
      amountNanos: 1230000000n, refundRequestId: request.id });
  };

  it.each(['WITHDRAWN', 'REJECTED', 'ordinary-refund', 'late-refund'] as const)(
    'keeps %s ordered and idempotent when the application clock moves behind database creation', async mode => {
      const success = event();
      if (mode === 'ordinary-refund') await review();
      if (mode === 'late-refund') await service.handleVerifiedRefundEvent(success);
      const initial = await db.aiWalletRefundEvent.findMany({ where: { organizationId: org }, orderBy: { eventId: 'asc' } });
      // Only Date is faked. Database, timers, I/O and transaction deadlines stay real;
      // no host clock or stored creation timestamp is changed.
      jest.useFakeTimers({ now: request.createdAt.getTime() - 2000,
        doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate',
          'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      try {
        if (mode === 'WITHDRAWN' || mode === 'REJECTED') await service.resolve(org, request.id, 'resolver', mode);
        else if (mode === 'late-refund') await review();
        else await service.handleVerifiedRefundEvent(success);
      } finally { jest.useRealTimers(); }
      const row = await db.aiWalletRefundRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.createdAt).toEqual(request.createdAt);
      expect(row.resolvedAt!.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
      const refunded = mode === 'ordinary-refund' || mode === 'late-refund';
      expect(row.status).toBe(refunded ? 'REFUNDED' : mode);
      await money(refunded);
      const before = await db.aiWalletRefundEvent.findMany({ where: { organizationId: org }, orderBy: { eventId: 'asc' } });
      for (const prior of initial) expect(before).toContainEqual(prior);
      if (refunded) expect(before).toHaveLength(1);
      const restarted = new AiWalletRefundRequestService({ model: db } as any);
      if (mode === 'WITHDRAWN' || mode === 'REJECTED') await restarted.resolve(org, request.id, 'other-actor', mode);
      else {
        await restarted.handleVerifiedRefundEvent(success);
        expect(await db.aiWalletRefundEvent.findMany({ where: { organizationId: org }, orderBy: { eventId: 'asc' } })).toEqual(before);
        await restarted.handleVerifiedRefundEvent(event('canceled'));
        expect((await review(restarted)).state).toBe('UNCERTAIN');
      }
      expect(await db.aiWalletRefundRequest.findUnique({ where: { id: request.id } })).toEqual(row);
      expect(await db.aiWalletRefundEvent.findMany({ where: { eventId: { in: before.map(e => e.eventId) } }, orderBy: { eventId: 'asc' } })).toEqual(before);
      await money(refunded);
    });
  it.each(['WITHDRAWN', 'ordinary-refund'] as const)('floors %s at immutable creation after a database clock step', async mode => {
    await service.resolve(org, request.id, 'fixture', 'WITHDRAWN');
    // A consistent new fixture models DB wall time moving backward after creation.
    // Never update an existing creation timestamp or change a host clock.
    request = await db.$transaction(async tx => {
      const [{ future }] = await tx.$queryRaw<{ future: Date }[]>`
        SELECT ((clock_timestamp() AT TIME ZONE 'UTC') + interval '1 minute')::timestamp(3) AS future`;
      const row = await tx.aiWalletRefundRequest.create({ data: { organizationId: org, operationKey: randomUUID(),
        requestedByUserId: 'requester', requestedNanos: 1230000000n, createdAt: future } });
      await tx.aiWallet.update({ where: { organizationId: org }, data: { heldNanos: { increment: 1230000000n } } });
      return row;
    });
    if (mode === 'WITHDRAWN') await service.resolve(org, request.id, 'resolver', mode);
    else { await review(); await service.handleVerifiedRefundEvent(event()); }
    const row = await db.aiWalletRefundRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.createdAt).toEqual(request.createdAt);
    expect(row.resolvedAt).toEqual(request.createdAt);
    await money(mode === 'ordinary-refund');
  });

  it('uses wall time at the transition rather than the transaction start', async () => {
    await db.$transaction(async tx => {
      const [{ started }] = await tx.$queryRaw<{ started: Date }[]>`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3) AS started`;
      await new Promise(resolve => setTimeout(resolve, 30));
      const [{ marker }] = await tx.$queryRaw<{ marker: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS marker`;
      expect(marker.getTime()).toBeGreaterThan(started.getTime());
      const sameTransaction = new AiWalletRefundRequestService({ model: { $transaction: (fn: any) => fn(tx) } } as any);
      const row = await sameTransaction.resolve(org, request.id, 'resolver', 'REJECTED');
      expect(row.resolvedAt!.getTime()).toBeGreaterThanOrEqual(marker.getTime());
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await money(false);
  });

  it('retains the database ordering constraint and rolls back invalid transitions', async () => {
    await expect(db.$transaction(async tx => {
      await tx.aiWallet.update({ where: { organizationId: org }, data: { heldNanos: 0n } });
      await tx.aiWalletRefundRequest.update({ where: { id: request.id }, data: { status: 'WITHDRAWN',
        resolvedByUserId: 'invalid-fixture', resolvedAt: new Date(request.createdAt.getTime() - 1) } });
    })).rejects.toThrow('AiWalletRefundRequest_resolution');
    expect(await db.aiWalletRefundRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .toMatchObject({ status: 'REQUESTED', resolvedAt: null, createdAt: request.createdAt });
    expect(await db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } }))
      .toMatchObject({ balanceNanos: 1230000000n, heldNanos: 1230000000n });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'REVERSAL' } })).toBe(0);
  });
});
