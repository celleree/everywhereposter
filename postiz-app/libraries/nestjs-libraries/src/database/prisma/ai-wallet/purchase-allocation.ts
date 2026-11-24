import { Prisma, PrismaClient } from '@prisma/client';

type Domain = {
  organizationId: string;
  stripeAccountId: string;
  stripeMode: 'test' | 'live';
  accountingVersion: 1;
};

/** Dormant INITIAL allocation only. Callers own owners, totals and ledger writes.
 * No provider work belongs in this callback. Direct writers must honor the lock. */
export function withPurchaseAllocation<T>(client: PrismaClient, expectedDomain: Domain,
  callback: (scope: { tx: Prisma.TransactionClient; allocateReservation: (id: string) =>
    Promise<Prisma.AiWalletPurchaseAllocationGetPayload<{}>[]> }) => Promise<T>): Promise<T> {
  const domain = { ...expectedDomain }, { organizationId } = domain;
  const invalid = () => Error('Purchase allocation requires coherent INITIAL history.');
  const validate = async (tx: Prisma.TransactionClient) => {
    const wallet = await tx.aiWallet.findUnique({ where: { organizationId }, include: { purchaseCohort: true } });
    const cohort = wallet?.purchaseCohort;
    if (!wallet || wallet.status !== 'ACTIVE' || !cohort || domain.accountingVersion !== 1 ||
      cohort.accountingVersion !== domain.accountingVersion || cohort.stripeAccountId !== domain.stripeAccountId ||
      cohort.stripeMode !== domain.stripeMode) throw Error('Active purchase cohort/domain required.');
  };
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 3))::text`;
    await tx.$queryRaw`SELECT "organizationId" FROM "AiWallet" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
    await validate(tx);
    const allocate = async (id: string) => {
      await validate(tx); // Caller writes may have changed the wallet since entry or a replay.
      const [reservations, refunds, allocations, lots, ledger] = await Promise.all([
        tx.aiWalletReservation.findMany({ where: { organizationId } }),
        tx.aiWalletRefundRequest.findMany({ where: { organizationId } }),
        tx.aiWalletPurchaseAllocation.findMany({ where: { organizationId } }),
        tx.aiWalletTopup.findMany({ where: { organizationId, fundedAt: { not: null } },
          orderBy: [{ fundedAt: 'asc' }, { id: 'asc' }] }),
        tx.aiWalletLedger.findFirst({ where: { organizationId, kind: { in: ['USAGE', 'REVERSAL'] } } }),
      ]);
      const target = reservations.find(row => row.id === id);
      if (!target || target.state !== 'RESERVED') throw invalid();
      if (ledger || reservations.some(row => row.chargedNanos !== null || row.ceilingNanos <= 0n ||
        !['RESERVED', 'DISPATCHED', 'UNKNOWN'].includes(row.state)) ||
        refunds.some(row => row.status !== 'REQUESTED' || row.requestedNanos <= 0n)) throw invalid();
      const capacity = new Map<string, bigint>(), coverage = new Map<string, bigint>();
      for (const lot of lots) {
        if (lot.checkoutState !== 'BOUND' || lot.stripeAccountId !== domain.stripeAccountId ||
          lot.stripeMode !== domain.stripeMode || lot.currency !== 'usd' ||
          !Number.isSafeInteger(lot.amountCents) || lot.amountCents <= 0) throw invalid();
        capacity.set(lot.id, BigInt(lot.amountCents) * 10000000n);
      }
      for (const row of allocations) {
        if (row.closedAt !== null || row.consumedNanos !== null || row.allocatedNanos <= 0n ||
          (row.reservationId !== null) === (row.refundRequestId !== null) || !capacity.has(row.topupId)) throw invalid();
        const key = row.reservationId === null ? 'f:' + row.refundRequestId : 'r:' + row.reservationId;
        coverage.set(key, (coverage.get(key) ?? 0n) + row.allocatedNanos);
        capacity.set(row.topupId, capacity.get(row.topupId)! - row.allocatedNanos);
      }
      // Check every lot, even later lots during an otherwise exact replay.
      if ([...capacity.values()].some(amount => amount < 0n)) throw invalid();
      for (const row of reservations) {
        const amount = coverage.get('r:' + row.id) ?? 0n;
        if (amount !== row.ceilingNanos && !(row.id === id && amount === 0n)) throw invalid();
        coverage.delete('r:' + row.id);
      }
      for (const row of refunds) {
        if (coverage.get('f:' + row.id) !== row.requestedNanos) throw invalid();
        coverage.delete('f:' + row.id);
      }
      if (coverage.size) throw invalid();
      const ordered = () => tx.aiWalletPurchaseAllocation.findMany({ where: { organizationId, reservationId: id },
        orderBy: [{ topup: { fundedAt: 'asc' } }, { topupId: 'asc' }] });
      if (allocations.some(row => row.reservationId === id)) return ordered();
      let remaining = target.ceilingNanos;
      const plan: Prisma.AiWalletPurchaseAllocationCreateManyInput[] = [];
      for (const lot of lots) {
        const amount = capacity.get(lot.id)! < remaining ? capacity.get(lot.id)! : remaining;
        if (amount > 0n) plan.push({ organizationId, topupId: lot.id, reservationId: id, allocatedNanos: amount });
        remaining -= amount;
        if (remaining === 0n) break;
      }
      if (remaining !== 0n) throw Error('Insufficient purchased credit.');
      await tx.aiWalletPurchaseAllocation.createMany({ data: plan });
      return ordered();
    };
    let active = true, busy = false, failed = false, failure: unknown;
    let pending: ReturnType<typeof allocate> | undefined;
    const retain = (error: unknown) => { if (!failed) { failed = true; failure = error; } };
    const allocateReservation = (id: string) => {
      if (!active) throw Error('Purchase allocation capability expired.');
      if (busy) {
        const error = Error('Overlapping purchase allocation calls.');
        retain(error); throw error;
      }
      busy = true;
      pending = allocate(id).then(rows => { busy = false; return rows; }, error => {
        busy = false; retain(error); throw error;
      });
      void pending.catch(() => {}); // Ignored calls are handled, but remain transaction-fatal.
      return pending;
    };
    let callbackFailed = false, callbackError: unknown, result!: T;
    try { result = await callback({ tx, allocateReservation }); }
    catch (error) { callbackFailed = true; callbackError = error; }
    active = false;
    if (busy) retain(Error('Purchase allocation was not awaited.'));
    if (pending) await pending.catch(() => {});
    if (callbackFailed) throw callbackError;
    if (failed) throw failure;
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
}
