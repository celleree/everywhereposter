import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const fixture = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixture ? describe : describe.skip)('dormant purchase-accounting database contract', () => {
  let db: PrismaClient, peer: PrismaClient, org: string;
  const account = 'acct_synthetic', now = () => new Date();
  const wallet = async () => {
    const id = randomUUID();
    await db.organization.create({ data: { id, name: 'Synthetic purchase accounting' } });
    await db.aiWallet.create({ data: { organizationId: id } }); return id;
  };
  const cohort = (id = org, data: any = {}, client: any = db) => client.aiWalletPurchaseCohort.create({
    data: { organizationId: id, stripeAccountId: account, stripeMode: 'test', ...data } });
  const topup = (id = org, data: any = {}, client: any = db) => client.aiWalletTopup.create({ data: {
    organizationId: id, operationKey: randomUUID(), customerId: 'cus_synthetic', amountCents: 1, currency: 'usd',
    sessionId: 'cs_' + randomUUID(), paymentId: 'pi_' + randomUUID(), fundedAt: now(), checkoutState: 'BOUND',
    stripeAccountId: account, stripeMode: 'test', requestFingerprint: 'a'.repeat(64), requestSnapshot: {},
    firstDispatchedAt: now(), ...data } });
  const legacy = (id = org, client: any = db) => topup(id, { fundedAt: null, sessionId: null, paymentId: null,
    checkoutState: 'LEGACY', stripeAccountId: null, stripeMode: null, requestFingerprint: null,
    requestSnapshot: Prisma.DbNull, firstDispatchedAt: null }, client);
  const owner = (kind = 'reservation', id = org) => kind === 'reservation'
    ? db.aiWalletReservation.create({ data: { organizationId: id, operationKey: randomUUID(),
      provider: 'synthetic', model: 'synthetic', ceilingNanos: 100n } })
    : db.aiWalletRefundRequest.create({ data: { organizationId: id, operationKey: randomUUID(),
      requestedByUserId: 'synthetic', requestedNanos: 100n } });
  const owned = (kind: string, id: string) => kind === 'reservation' ? { reservationId: id } : { refundRequestId: id };
  const allocation = (source: string, data: any = {}, client: any = db) => client.aiWalletPurchaseAllocation.create({
    data: { organizationId: org, topupId: source, allocatedNanos: 100n, ...data } });
  const prepared = async (kind = 'reservation') => {
    await cohort(); const t = await topup(), o = await owner(kind);
    return allocation(t.id, owned(kind, o.id));
  };
  const close = (id: string, data: any = {}, client: any = db) => client.aiWalletPurchaseAllocation.update({
    where: { id }, data: { consumedNanos: 50n, closedAt: now(), ...data } });
  beforeAll(async () => {
    const u = new URL(fixture!);
    if (u.protocol !== 'postgresql:' || u.hostname !== '127.0.0.1' || u.pathname !== '/ep_ai_wallet_test'
      || u.username !== 'isolated' || u.password !== 'isolated' || !u.port || u.search || u.hash) throw Error('Owned isolated wallet fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixture } } });
    peer = new PrismaClient({ datasources: { db: { url: fixture } } });
    await Promise.all([db.$connect(), peer.$connect()]);
  });
  beforeEach(async () => { org = await wallet(); });
  afterAll(async () => { await Promise.all([db?.$disconnect(), peer?.$disconnect()]); });

  it.each(['test', 'live'])('enrolls pristine %s wallets without changing money/history', async stripeMode => {
    const before = await db.aiWallet.findUnique({ where: { organizationId: org } });
    expect(await cohort(org, { stripeMode })).toMatchObject({ stripeMode, accountingVersion: 1 });
    expect(await db.aiWallet.findUnique({ where: { organizationId: org } })).toEqual(before);
    expect(await db.aiWalletPurchaseAllocation.count({ where: { organizationId: org } })).toBe(0);
  });
  it.each([{ stripeAccountId: '' }, { stripeAccountId: 'acct_' }, { stripeAccountId: 'acct_bad-dash' },
    { stripeAccountId: 'acct_' + 'a'.repeat(101) }, { stripeMode: 'LIVE' }, { stripeMode: '' },
    { accountingVersion: 0 }, { accountingVersion: 2 }])('rejects invalid cohort domain %j', async data => {
    await expect(cohort(org, data)).rejects.toThrow();
  });
  it.each(['missing', 'review', 'balance', 'held', 'unpaid-topup', 'ledger', 'reservation', 'refund'])(
    'rejects nonpristine enrollment: %s', async state => {
      if (state === 'missing') org = randomUUID();
      if (state === 'review') await db.aiWallet.update({ where: { organizationId: org }, data: { status: 'REVIEW' } });
      if (state === 'balance' || state === 'held') await db.aiWallet.update({ where: { organizationId: org },
        data: { balanceNanos: 1n, heldNanos: state === 'held' ? 1n : 0n } });
      if (state === 'unpaid-topup') await legacy();
      if (state === 'reservation' || state === 'refund') await owner(state);
      if (state === 'ledger') {
        const t = await topup();
        await db.aiWalletLedger.create({ data: { organizationId: org, externalKey: randomUUID(),
          kind: 'FUNDING', amountNanos: 1n, topupId: t.id } });
      }
      await expect(cohort()).rejects.toThrow('pristine');
    });
  it('rejects duplicate cohorts', async () => { await cohort(); await expect(cohort()).rejects.toThrow(); });
  it.each(['organizationId', 'stripeAccountId', 'stripeMode', 'accountingVersion', 'createdAt', 'noop', 'delete'])(
    'keeps cohort history immutable: %s', async field => {
      const row = await cohort();
      const data: any = { organizationId: await wallet(), stripeAccountId: 'acct_other', stripeMode: 'live',
        accountingVersion: 2, createdAt: new Date(0) };
      await expect(field === 'delete' ? db.aiWalletPurchaseCohort.delete({ where: { organizationId: org } })
        : db.aiWalletPurchaseCohort.update({ where: { organizationId: org },
          data: field === 'noop' ? { stripeMode: 'test' } : { [field]: data[field] } })).rejects.toThrow('immutable');
      expect(await db.aiWalletPurchaseCohort.findUnique({ where: { organizationId: org } })).toEqual(row);
    });
  it.each([Prisma.TransactionIsolationLevel.RepeatableRead, Prisma.TransactionIsolationLevel.Serializable])(
    'rejects stale %s enrollment snapshots', async isolationLevel => {
      await expect(db.$transaction(async tx => {
        await tx.aiWallet.count(); // Establish the transaction snapshot before another writer commits.
        await legacy(org, peer);
        await cohort(org, {}, tx);
      }, { isolationLevel })).rejects.toThrow('READ COMMITTED');
      expect(await db.aiWalletPurchaseCohort.count({ where: { organizationId: org } })).toBe(0);
    });
  it('waits on namespace 3 and sees the committed unpaid topup after locking', async () => {
    let start!: () => void, announce!: (pid: number) => void;
    const locked = new Promise<void>(resolve => { start = resolve; });
    const pid = new Promise<number>(resolve => { announce = resolve; });
    const writer = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${org}, 3))::text`; start();
      const initializerPid = await pid; let blocked = false;
      const deadline = Date.now() + 5000;
      while (!blocked && Date.now() < deadline) {
        const [row] = await tx.$queryRaw<{ blocked: boolean }[]>`SELECT pg_backend_pid() = ANY(pg_blocking_pids(${initializerPid}::integer)) AS blocked`;
        blocked = row.blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true); await legacy(org, tx);
    }, { timeout: 10000 });
    await locked;
    const initializer = peer.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; announce(row.pid);
      return cohort(org, {}, tx);
    }, { timeout: 10000 }).then(value => ({ value, error: null }), error => ({ value: null, error }));
    await writer;
    expect((await initializer).error?.message).toContain('pristine');
    expect(await db.aiWalletPurchaseCohort.count({ where: { organizationId: org } })).toBe(0);
    expect(await db.aiWalletTopup.count({ where: { organizationId: org } })).toBe(1);
  });
  it('allows exactly one concurrent cohort enrollment', async () => {
    const results = await Promise.allSettled([cohort(), cohort(org, {}, peer)]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await db.aiWalletPurchaseCohort.count({ where: { organizationId: org } })).toBe(1);
  });
  it('rolls back enrollment without leaving a cohort', async () => {
    await expect(db.$transaction(async tx => { await cohort(org, {}, tx); throw Error('rollback'); })).rejects.toThrow('rollback');
    expect(await db.aiWalletPurchaseCohort.count({ where: { organizationId: org } })).toBe(0);
    await cohort();
  });
  it.each(['reservation', 'refund'])('allows %s ownership across multiple lots', async kind => {
    await cohort(); const o = await owner(kind), a = await topup(), b = await topup();
    const rows = await Promise.all([allocation(a.id, owned(kind, o.id)), allocation(b.id, owned(kind, o.id))]);
    expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ consumedNanos: null, closedAt: null });
  });
  it.each(['missing', 'unfunded', 'legacy', 'dispatched', 'organization', 'account', 'mode', 'no-cohort'])(
    'rejects invalid source provenance: %s', async kind => {
      if (kind !== 'no-cohort') await cohort(org, kind === 'mode' ? { stripeMode: 'live' } : {});
      const o = await owner();
      const sourceOrg = kind === 'organization' ? await wallet() : org;
      const t = kind === 'legacy' ? await legacy() : await topup(sourceOrg, {
        ...(kind === 'unfunded' ? { fundedAt: null } : {}),
        ...(kind === 'dispatched' ? { fundedAt: null, sessionId: null, checkoutState: 'DISPATCHED' } : {}),
        ...(kind === 'account' ? { stripeAccountId: 'acct_other' } : {}) });
      await expect(allocation(kind === 'missing' ? randomUUID() : t.id, { reservationId: o.id })).rejects.toThrow();
    });
  it('retains the existing prohibition on live topups', async () => {
    await cohort(org, { stripeMode: 'live' }); await expect(topup(org, { stripeMode: 'live' })).rejects.toThrow('checkout_shape');
  });
  it.each(['none', 'both', 'missing-reservation', 'missing-refund', 'cross-reservation', 'cross-refund'])(
    'rejects invalid ownership: %s', async kind => {
      await cohort(); const t = await topup();
      let data: any = {};
      if (kind === 'both') data = { reservationId: (await owner()).id, refundRequestId: (await owner('refund')).id };
      if (kind.startsWith('missing')) data = owned(kind.endsWith('refund') ? 'refund' : 'reservation', randomUUID());
      if (kind.startsWith('cross')) {
        const type = kind.endsWith('refund') ? 'refund' : 'reservation';
        data = owned(type, (await owner(type, await wallet())).id);
      }
      await expect(allocation(t.id, data)).rejects.toThrow();
    });
  it.each([0n, -1n])('requires positive allocation %s', async allocatedNanos => {
    await cohort(); await expect(allocation((await topup()).id, { reservationId: (await owner()).id, allocatedNanos })).rejects.toThrow();
  });
  it.each(['reservation', 'refund'])('rejects duplicate %s/source allocations concurrently', async kind => {
    await cohort(); const t = await topup(), data = owned(kind, (await owner(kind)).id);
    const results = await Promise.allSettled([allocation(t.id, data), allocation(t.id, data, peer)]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await db.aiWalletPurchaseAllocation.count({ where: { topupId: t.id } })).toBe(1);
  });
  it.each([{ consumedNanos: 0n }, { closedAt: new Date() }, { consumedNanos: 0n, closedAt: new Date() }])(
    'requires open insertion: %p', async data => {
      await cohort(); await expect(allocation((await topup()).id, { reservationId: (await owner()).id, ...data })).rejects.toThrow('inserted open');
    });
  it.each([0n, 50n, 100n])('closes exactly once with consumption %s', async consumedNanos => {
    const a = await prepared(); const row = await close(a.id, { consumedNanos });
    expect(row).toMatchObject({ consumedNanos, allocatedNanos: 100n });
    expect(row.closedAt!.getTime()).toBeGreaterThanOrEqual(a.createdAt.getTime());
  });
  it.each([{ consumedNanos: -1n }, { consumedNanos: 101n }, { closedAt: new Date(0) },
    { consumedNanos: null }, { closedAt: null }, { consumedNanos: null, closedAt: null }])(
    'rolls back invalid closure %p', async data => {
      const a = await prepared(); await expect(close(a.id, data)).rejects.toThrow();
      expect(await db.aiWalletPurchaseAllocation.findUnique({ where: { id: a.id } })).toEqual(a);
    });
  it.each(['id', 'organizationId', 'topupId', 'reservationId', 'refundRequestId', 'allocatedNanos', 'createdAt'])(
    'rejects identity change on closure: %s', async field => {
      const a = await prepared(); const values: any = { id: randomUUID(), organizationId: await wallet(),
        topupId: (await topup()).id, reservationId: (await owner()).id,
        refundRequestId: (await owner('refund')).id, allocatedNanos: 101n, createdAt: new Date(0) };
      await expect(close(a.id, { [field]: values[field] })).rejects.toThrow('immutable');
    });
  it.each(['reopen', 'second-close', 'noop', 'delete'])('protects closed history: %s', async action => {
    const a = await prepared(), row = await close(a.id);
    await expect(action === 'delete' ? db.aiWalletPurchaseAllocation.delete({ where: { id: a.id } })
      : close(a.id, action === 'reopen' ? { consumedNanos: null, closedAt: null }
        : action === 'noop' ? { consumedNanos: row.consumedNanos, closedAt: row.closedAt } : {})).rejects.toThrow();
    expect(await db.aiWalletPurchaseAllocation.findUnique({ where: { id: a.id } })).toEqual(row);
  });
  it('rejects deleting open allocation history', async () => {
    const a = await prepared(); await expect(db.aiWalletPurchaseAllocation.delete({ where: { id: a.id } })).rejects.toThrow('deleted');
  });
  it.each(['wallet', 'topup', 'reservation', 'refund'])('blocks referenced %s reparenting and deletion', async kind => {
    const a = await prepared(kind === 'refund' ? 'refund' : 'reservation'), other = await wallet();
    const model: any = kind === 'wallet' ? db.aiWallet : kind === 'topup' ? db.aiWalletTopup
      : kind === 'refund' ? db.aiWalletRefundRequest : db.aiWalletReservation;
    const where = kind === 'wallet' ? { organizationId: org } : { id: kind === 'topup' ? a.topupId
      : kind === 'refund' ? a.refundRequestId : a.reservationId };
    await expect(model.update({ where, data: { organizationId: other } })).rejects.toThrow();
    if (kind !== 'wallet') await expect(model.update({ where, data: { id: randomUUID() } })).rejects.toThrow();
    await expect(model.delete({ where })).rejects.toThrow();
  });
  it('rolls back a closure together with other transaction writes', async () => {
    const a = await prepared(), before = await db.aiWallet.findUnique({ where: { organizationId: org } });
    await expect(db.$transaction(async tx => {
      await close(a.id, {}, tx); await tx.aiWallet.update({ where: { organizationId: org }, data: { balanceNanos: 1n } });
      throw Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await db.aiWalletPurchaseAllocation.findUnique({ where: { id: a.id } })).toEqual(a);
    expect(await db.aiWallet.findUnique({ where: { organizationId: org } })).toEqual(before);
  });
  it('allows exactly one concurrent closer and retains its result', async () => {
    const a = await prepared();
    const results = await Promise.allSettled([close(a.id, { consumedNanos: 20n }), close(a.id, { consumedNanos: 80n }, peer)]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const winner = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>;
    expect(await db.aiWalletPurchaseAllocation.findUnique({ where: { id: a.id } })).toEqual(winner.value);
  });
});
