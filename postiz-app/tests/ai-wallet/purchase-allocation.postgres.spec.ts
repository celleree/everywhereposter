import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { withPurchaseAllocation } from '../../libraries/nestjs-libraries/src/database/prisma/ai-wallet/purchase-allocation';

type Scope = Parameters<Parameters<typeof withPurchaseAllocation>[2]>[0];
const compileOnly = (tx: Prisma.TransactionClient, scope: Scope) => {
  // @ts-expect-error A transaction client cannot open the gateway's transaction.
  void withPurchaseAllocation(tx, {} as any, async () => {});
  // @ts-expect-error The bound capability accepts neither an amount nor a client.
  void scope.allocateReservation('id', 1n, tx);
};
void compileOnly;
const fixture = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixture ? describe : describe.skip)('dormant INITIAL purchase allocation', () => {
  let db: PrismaClient, peer: PrismaClient, org: string;
  const account = 'acct_synthetic', unit = 10000000n, max = 9223372036854775807n;
  const domain = (id = org, data: any = {}) => ({ organizationId: id, stripeAccountId: account,
    stripeMode: 'test' as const, accountingVersion: 1 as const, ...data });
  const wallet = async (stripeMode = 'test', enroll = true) => {
    const id = randomUUID();
    await db.organization.create({ data: { id, name: 'Synthetic INITIAL allocation' } });
    await db.aiWallet.create({ data: { organizationId: id } });
    if (enroll) await db.aiWalletPurchaseCohort.create({ data: { organizationId: id, stripeAccountId: account, stripeMode } });
    return id;
  };
  const topup = (data: any = {}, client: Prisma.TransactionClient = db, id = org) =>
    client.aiWalletTopup.create({ data: { organizationId: id, operationKey: randomUUID(),
      customerId: 'cus_synthetic', amountCents: 1, currency: 'usd', fundedAt: new Date(),
      sessionId: 'cs_' + randomUUID(), paymentId: 'pi_' + randomUUID(), checkoutState: 'BOUND',
      stripeAccountId: account, stripeMode: 'test', requestFingerprint: 'a'.repeat(64),
      requestSnapshot: {}, firstDispatchedAt: new Date(), ...data } });
  const intent = (state: string, funded = false) => topup({ checkoutState: state,
    fundedAt: funded ? new Date() : null, ...(state === 'LEGACY' ? { stripeAccountId: null,
      stripeMode: null, requestFingerprint: null, requestSnapshot: Prisma.DbNull, firstDispatchedAt: null } : {}),
    ...(['PREPARED', 'DISPATCHED'].includes(state) ? { sessionId: null } : {}),
    ...(state === 'PREPARED' ? { firstDispatchedAt: null } : {}) });
  const owner = (data: any = {}, client: Prisma.TransactionClient = db, id = org) =>
    client.aiWalletReservation.create({ data: { organizationId: id, operationKey: randomUUID(),
      provider: 'synthetic', model: 'synthetic', ceilingNanos: 1n, ...data } });
  const refund = (data: any = {}) => db.aiWalletRefundRequest.create({ data: {
    organizationId: org, operationKey: randomUUID(), requestedByUserId: 'synthetic', requestedNanos: 1n, ...data } });
  const allocation = (topupId: string, data: any) => db.aiWalletPurchaseAllocation.create({
    data: { organizationId: org, topupId, allocatedNanos: 1n, ...data } });
  const run = (id: string, client = db) => withPurchaseAllocation(client, domain(), s => s.allocateReservation(id));
  const snapshot = (ids = [org]) => {
    const where = { organizationId: { in: ids } }, orderBy = { id: 'asc' as const };
    return Promise.all([db.organization.findMany({ where: { id: { in: ids } }, orderBy }),
      db.aiWallet.findMany({ where, orderBy: { organizationId: 'asc' } }),
      db.aiWalletPurchaseCohort.findMany({ where, orderBy: { organizationId: 'asc' } }),
      db.aiWalletTopup.findMany({ where, orderBy }), db.aiWalletReservation.findMany({ where, orderBy }),
      db.aiWalletRefundRequest.findMany({ where, orderBy }), db.aiWalletLedger.findMany({ where, orderBy }),
      db.aiWalletPurchaseAllocation.findMany({ where, orderBy })]);
  };
  const unchanged = async (action: () => Promise<unknown>, ids = [org]) => {
    const before = await snapshot(ids); await expect(action()).rejects.toBeDefined();
    expect(await snapshot(ids)).toEqual(before);
  };
  const replay = async () => { const t = await topup(), r = await owner();
    const a = await allocation(t.id, { reservationId: r.id }); return { t, r, a }; };
  const writes = async (tx: Prisma.TransactionClient, t: string) => {
    await tx.aiWallet.update({ where: { organizationId: org }, data: { balanceNanos: 1n, heldNanos: 1n } });
    await tx.aiWalletLedger.create({ data: { organizationId: org, externalKey: randomUUID(),
      kind: 'FUNDING', topupId: t, amountNanos: 1n } });
  };
  beforeAll(async () => {
    const u = new URL(fixture!);
    if (u.protocol !== 'postgresql:' || u.hostname !== '127.0.0.1' || u.pathname !== '/ep_ai_wallet_test' ||
      u.username !== 'isolated' || u.password !== 'isolated' || !u.port || u.search || u.hash) throw Error('Owned fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixture } } });
    peer = new PrismaClient({ datasources: { db: { url: fixture } } });
    await Promise.all([db.$connect(), peer.$connect()]);
  });
  beforeEach(async () => { org = await wallet(); });
  afterAll(async () => { await Promise.all([db?.$disconnect(), peer?.$disconnect()]); });

  it.each(['wallet', 'cohort', 'review', 'organization', 'account', 'mode', 'version'])(
    'rejects gateway %s before callback', async kind => {
      if (kind === 'wallet') { org = randomUUID(); await db.organization.create({ data: { id: org, name: 'No wallet' } }); }
      if (kind === 'cohort') org = await wallet('test', false);
      if (kind === 'review') await db.aiWallet.update({ where: { organizationId: org }, data: { status: 'REVIEW' } });
      const other = await wallet(), callback = jest.fn(async () => 1);
      const changes: any = { organization: { organizationId: other }, account: { stripeAccountId: 'acct_other' },
        mode: { stripeMode: 'live' }, version: { accountingVersion: 2 } };
      // The organization mismatch is a real different cohort/account domain.
      if (kind === 'organization') changes.organization.stripeAccountId = 'acct_other';
      await unchanged(() => withPurchaseAllocation(db, domain(org, changes[kind]), callback), [org, other]);
      expect(callback).not.toHaveBeenCalled();
    });
  it.each(['test', 'live'])('admits existing %s cohort without positive live capacity', async stripeMode => {
    org = await wallet(stripeMode); const callback = jest.fn(async ({ tx }: Scope) => {
      expect((await tx.$queryRaw<any[]>`SHOW transaction_isolation`)[0].transaction_isolation).toBe('read committed'); return 7; });
    expect(await withPurchaseAllocation(db, domain(org, { stripeMode }), callback)).toBe(7);
    expect(callback).toHaveBeenCalledTimes(1);
    if (stripeMode === 'live') { const r = await owner();
      await unchanged(() => withPurchaseAllocation(db, domain(org, { stripeMode }), s => s.allocateReservation(r.id)));
      await expect(topup({ stripeMode: 'live' })).rejects.toThrow('checkout_shape'); }
  });
  it.each(['missing', 'foreign', 'DISPATCHED', 'UNKNOWN'])('rejects target %s', async kind => {
    const other = await wallet(); await topup();
    const r = await owner({ state: ['DISPATCHED', 'UNKNOWN'].includes(kind) ? kind : 'RESERVED' }, db,
      kind === 'foreign' ? other : org);
    await unchanged(() => run(kind === 'missing' ? randomUUID() : r.id), [org, other]);
  });
  it.each([false, true])('freshly rejects REVIEW after caller writes, replay=%s', async existing => {
    const { r } = existing ? await replay() : { r: await owner() }; if (!existing) await topup();
    await unchanged(() => withPurchaseAllocation(db, domain(), async s => {
      await s.tx.aiWallet.update({ where: { organizationId: org }, data: { status: 'REVIEW' } });
      await expect(s.allocateReservation(r.id)).rejects.toThrow('Active'); return 1;
    }));
  });
  it.each([1n, unit + 1n, 9007199254740993n])('allocates exact bigint demand %s in database FIFO order', async amount => {
    const cents = amount > unit * 2n ? 1000000000 : 1, time = new Date(1000), suffix = randomUUID();
    const later = await topup({ id: 'z' + suffix, fundedAt: time, amountCents: cents });
    const earlier = await topup({ id: 'a' + suffix, fundedAt: time, amountCents: cents });
    const r = await owner({ ceilingNanos: amount }), before = await snapshot();
    const rows = await run(r.id), first = BigInt(cents) * unit < amount ? BigInt(cents) * unit : amount;
    expect(rows.map(a => [a.topupId, a.allocatedNanos])).toEqual(first === amount
      ? [[earlier.id, amount]] : [[earlier.id, first], [later.id, amount - first]]);
    const after = await snapshot(); expect(after.slice(0, 7)).toEqual(before.slice(0, 7));
  });
  it('orders fundedAt before id rather than insertion order', async () => {
    const suffix = randomUUID(), newer = await topup({ id: 'a' + suffix, fundedAt: new Date(2000) }),
      older = await topup({ id: 'z' + suffix, fundedAt: new Date(1000) }), r = await owner({ ceilingNanos: unit + 1n });
    expect((await run(r.id)).map(a => [a.topupId, a.allocatedNanos])).toEqual([[older.id, unit], [newer.id, 1n]]);
  });
  it('sees callback-created owners and commits caller-owned money/ledger once', async () => {
    const t = await topup(), callback = jest.fn(async (s: Scope) => {
      const r = await owner({}, s.tx); const rows = await s.allocateReservation(r.id);
      await writes(s.tx, t.id); return rows[0].id; });
    const id = await withPurchaseAllocation(db, domain(), callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(await db.aiWalletPurchaseAllocation.findUnique({ where: { id } })).not.toBeNull();
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
    expect(await db.aiWallet.findUnique({ where: { organizationId: org } })).toMatchObject({ balanceNanos: 1n, heldNanos: 1n });
  });
  it('accounts for all supported reservation and refund holds', async () => {
    const t = await topup({ amountCents: 1 });
    for (const state of ['RESERVED', 'DISPATCHED', 'UNKNOWN']) {
      const r = await owner({ state }); await allocation(t.id, { reservationId: r.id }); }
    await allocation(t.id, { refundRequestId: (await refund()).id });
    const r = await owner({ ceilingNanos: unit - 4n });
    expect((await run(r.id))[0].allocatedNanos).toBe(unit - 4n);
  });
  it.each(['RESERVED', 'DISPATCHED', 'UNKNOWN', 'REQUESTED'].flatMap(kind =>
    ['missing', 'under', 'excess'].map(shape => [kind, shape])))('rejects %s %s coverage', async (kind, shape) => {
    const { t, r } = await replay(), o = kind === 'REQUESTED' ? await refund({ requestedNanos: 2n })
      : await owner({ state: kind, ceilingNanos: 2n });
    if (shape !== 'missing') await allocation(t.id, { [kind === 'REQUESTED' ? 'refundRequestId' : 'reservationId']: o.id,
      allocatedNanos: shape === 'under' ? 1n : 3n });
    await unchanged(() => run(r.id));
  });
  it('replays exact non-FIFO history stably across and within callbacks', async () => {
    await topup({ fundedAt: new Date(0) }); const { r, a } = await replay();
    const before = await snapshot();
    expect(await withPurchaseAllocation(db, domain(), async s => {
      const first = await s.allocateReservation(r.id); expect(await s.allocateReservation(r.id)).toEqual(first); return first;
    })).toEqual([a]);
    expect(await run(r.id)).toEqual([a]); expect(await snapshot()).toEqual(before);
  });
  it.each(['changed', 'partial', 'conflicting'])('rejects %s target replay', async kind => {
    const { r } = await replay();
    if (kind === 'conflicting') await allocation((await topup()).id, { reservationId: r.id });
    else await db.aiWalletReservation.update({ where: { id: r.id }, data: { ceilingNanos: kind === 'changed' ? 3n : 2n } });
    await unchanged(() => run(r.id));
  });
  it.each(['SETTLED', 'RELEASED', 'charged-zero', 'charged-positive', 'WITHDRAWN', 'REJECTED', 'REFUNDED',
    'closed-zero', 'closed-positive', 'USAGE', 'REVERSAL'])('rejects unrelated %s even during perfect replay', async kind => {
    const { t, r } = await replay();
    if (['WITHDRAWN', 'REJECTED', 'REFUNDED', 'REVERSAL'].includes(kind)) {
      const f = await refund(); await allocation(t.id, { refundRequestId: f.id });
      if (kind === 'REVERSAL') await db.aiWalletLedger.create({ data: { organizationId: org,
        externalKey: randomUUID(), kind, refundRequestId: f.id, amountNanos: 1n } });
      else await db.aiWalletRefundRequest.update({ where: { id: f.id }, data: {
        status: kind as any, resolvedByUserId: 'synthetic', resolvedAt: new Date() } });
    } else {
      const o = await owner(), a = await allocation(t.id, { reservationId: o.id });
      if (kind.startsWith('closed')) await db.aiWalletPurchaseAllocation.update({ where: { id: a.id },
        data: { consumedNanos: kind === 'closed-zero' ? 0n : 1n, closedAt: new Date() } });
      else if (kind === 'USAGE') await db.aiWalletLedger.create({ data: { organizationId: org,
        externalKey: randomUUID(), kind, reservationId: o.id, amountNanos: 1n } });
      else await db.aiWalletReservation.update({ where: { id: o.id }, data: kind.startsWith('charged')
        ? { chargedNanos: kind === 'charged-zero' ? 0n : 1n }
        : { state: kind as any, ...(kind === 'SETTLED' ? { chargedNanos: 0n, providerRequestId: randomUUID() } : {}) } });
    }
    await unchanged(() => run(r.id));
  });
  it.each(['consumedNanos', 'closedAt'])('cannot fabricate half-closed %s history under real constraints', async field => {
    const { r, a } = await replay();
    await unchanged(() => db.aiWalletPurchaseAllocation.update({ where: { id: a.id },
      data: field === 'consumedNanos' ? { consumedNanos: 0n } : { closedAt: new Date() } }));
    expect(await run(r.id)).toEqual([a]);
  });
  it.each(['legacy', 'account', 'test-under-live'])('rejects funded %s contamination', async kind => {
    if (kind === 'test-under-live') org = await wallet('live');
    const r = kind === 'test-under-live' ? await owner() : (await replay()).r;
    if (kind === 'legacy') await intent('LEGACY', true);
    else await topup(kind === 'account' ? { stripeAccountId: 'acct_other' } : {});
    await unchanged(() => withPurchaseAllocation(db, domain(org, { stripeMode: kind === 'test-under-live' ? 'live' : 'test' }),
      s => s.allocateReservation(r.id)));
  });
  it.each(['LEGACY', 'PREPARED', 'DISPATCHED', 'BOUND'])('ignores unfunded %s intents', async state => {
    await intent(state); const r = await owner(); await unchanged(() => run(r.id));
    const t = await topup(); expect((await run(r.id))[0].topupId).toBe(t.id);
  });
  it.each(['one-nano', 'bigint-sum', 'later-lot'])('rejects global negative capacity %s during replay', async kind => {
    const { r } = await replay(), t = await topup({ amountCents: 1000000000, fundedAt: new Date(Date.now() + 1000) });
    const amounts = kind === 'bigint-sum' ? [max, max] : [10000000000000001n];
    for (const amount of amounts) { const o = await owner({ ceilingNanos: amount });
      await allocation(t.id, { reservationId: o.id, allocatedNanos: amount }); }
    await unchanged(() => run(r.id));
  });
  it('plans full sufficiency before inserting any prefix', async () => {
    await topup(); await topup(); const r = await owner({ ceilingNanos: unit * 2n + 1n });
    await unchanged(() => run(r.id));
  });
  it.each(['error', 'P2034', 'null', 'undefined', 'false'])('rolls back caller writes with %s and never retries', async kind => {
    const t = await topup(), r = await owner(), error = kind === 'P2034'
      ? new Prisma.PrismaClientKnownRequestError('synthetic', { code: 'P2034', clientVersion: 'synthetic' })
      : kind === 'error' ? Error('caller') : kind === 'null' ? null : kind === 'false' ? false : undefined;
    let count = 0; const before = await snapshot();
    const result = await withPurchaseAllocation(db, domain(), async s => {
      count++; await s.allocateReservation(r.id); await writes(s.tx, t.id); throw error;
    }).then(() => ({ ok: true, error: 'unexpected' }), error => ({ ok: false, error }));
    expect(result).toEqual({ ok: false, error }); expect(count).toBe(1); expect(await snapshot()).toEqual(before);
  });
  it.each(['caught', 'ignored-completed', 'overlap', 'own-error'])('makes %s allocation failure transaction-fatal', async kind => {
    const t = await topup(), r = await owner(), own = Error('own'), unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try { await unchanged(() => withPurchaseAllocation(db, domain(), async s => {
      if (kind === 'overlap') {
        const p = s.allocateReservation(r.id);
        try { expect(() => s.allocateReservation(r.id)).toThrow('Overlapping'); } finally { await p; }
      } else if (kind === 'ignored-completed') {
        void s.allocateReservation(randomUUID());
        await s.tx.$queryRaw`SELECT 1`; await s.tx.$queryRaw`SELECT 1`;
        await s.allocateReservation(r.id); // Proves the ignored call completed, while retaining its failure.
      } else await s.allocateReservation(randomUUID()).catch(() => {});
      await writes(s.tx, t.id); if (kind === 'own-error') throw own; return 1;
    }).catch(error => { if (kind === 'own-error') expect(error).toBe(own); throw error; }));
      await new Promise(resolve => setImmediate(resolve)); expect(unhandled).not.toHaveBeenCalled();
    } finally { process.off('unhandledRejection', unhandled); }
  });
  it.each([false, true])('revokes escaped capability after rollback=%s', async rollback => {
    const r = await owner(); await topup(); let captured!: Scope['allocateReservation'];
    const action = () => withPurchaseAllocation(db, domain(), async s => {
      captured = s.allocateReservation; await captured(r.id); if (rollback) throw Error('rollback'); });
    if (rollback) await unchanged(action); else await action();
    const before = await snapshot(); expect(() => captured(r.id)).toThrow('expired'); expect(await snapshot()).toEqual(before);
  });
  it.each([false, true])('revokes immediately and drains pending work on callback throw=%s', async thrown => {
    const t = await topup(), r = await owner(), before = await snapshot(), own = Error('callback');
    let release!: () => void, announce!: () => void, captured!: Scope['allocateReservation'], pending!: Promise<unknown>;
    const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { announce = resolve; });
    let settled = false;
    const operation = withPurchaseAllocation(db, domain(), async s => {
      captured = s.allocateReservation; await writes(s.tx, t.id);
      const original = s.tx.aiWallet.findUnique.bind(s.tx.aiWallet);
      jest.spyOn(s.tx.aiWallet, 'findUnique').mockImplementationOnce((async (args: any) => {
        const row = await original(args); announce(); await gate; return row;
      }) as any);
      pending = captured(r.id); await entered; if (thrown) throw own; return 1;
    }).then(() => { settled = true; return { error: null }; }, error => { settled = true; return { error }; });
    try { await entered; await new Promise(resolve => setImmediate(resolve));
      expect(() => captured(r.id)).toThrow('expired'); expect(settled).toBe(false);
    } finally { release(); await pending?.catch(() => {}); }
    const result = await operation;
    if (thrown) expect(result.error).toBe(own); else expect(result.error.message).toContain('not awaited');
    expect(await snapshot()).toEqual(before);
  });
  const observe = async (tx: Prisma.TransactionClient, advisoryWait: boolean) => {
    const deadline = Date.now() + 5000;
    do {
      const rows = await tx.$queryRaw<{ pid: number }[]>`SELECT l.pid FROM pg_locks l
        WHERE l.locktype = 'advisory' AND l.objsubid = 1
          AND l.classid::bigint = ((hashtextextended(${org}, 3) >> 32) & 4294967295)
          AND l.objid::bigint = (hashtextextended(${org}, 3) & 4294967295)
          AND l.granted = ${!advisoryWait}
          AND pg_backend_pid() = ANY(pg_blocking_pids(l.pid))`;
      if (rows.length === 1) return rows[0].pid;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw Error('Exact advisory/wallet waiter was not observed');
  };
  it.each(['advisory', 'wallet'])('proves real %s blocking and fresh READ COMMITTED state', async kind => {
    const a = await topup(); let locked!: () => void, start!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; }), started = new Promise<void>(resolve => { start = resolve; });
    let bLot = '', entered = 0;
    const write = async (tx: Prisma.TransactionClient, allocate?: Scope['allocateReservation']) => {
      locked(); await started; expect(await observe(tx, kind === 'advisory')).toBeGreaterThan(0);
      if (kind === 'wallet') await tx.aiWallet.update({ where: { organizationId: org }, data: { status: 'REVIEW' } });
      else {
        const r = await owner({ ceilingNanos: unit }, tx);
        expect((await allocate!(r.id))[0].topupId).toBe(a.id);
        bLot = (await topup({}, tx)).id;
      }
    };
    const writer = kind === 'advisory' ? withPurchaseAllocation(db, domain(), s => write(s.tx, s.allocateReservation))
      : db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "organizationId" FROM "AiWallet" WHERE "organizationId" = ${org} FOR UPDATE`;
        await write(tx);
      }, { timeout: 15000 });
    await ready;
    const reader = withPurchaseAllocation(peer, domain(), async s => {
      entered++; const r = await owner({}, s.tx); return s.allocateReservation(r.id);
    }).then(value => ({ value, error: null }), error => ({ value: null, error }));
    start();
    try { await writer; const result = await reader;
      if (kind === 'wallet') { expect(entered).toBe(0); expect(result.error.message).toContain('Active'); }
      else { expect(result.error).toBeNull(); expect(result.value![0].topupId).toBe(bLot); }
    } finally { await Promise.allSettled([writer, reader]); }
  });
});
