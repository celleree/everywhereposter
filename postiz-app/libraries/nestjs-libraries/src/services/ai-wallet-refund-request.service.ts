import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AiWalletRefundRequest, Prisma } from '@prisma/client';
import { PrismaTransaction } from '../database/prisma/prisma.service';
import { walletHoldSnapshot } from './ai-wallet-holds';

/** Durable manual-review requests only. Never expires value or calls a payment,
 * email or refund provider. Request holds share the spend serialization lock. */
@Injectable()
export class AiWalletRefundRequestService {
  constructor(private readonly transactions: PrismaTransaction) {}
  private async transact<T>(organizationId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!organizationId?.trim() || organizationId.length > 200) throw new BadRequestException('Invalid organization.');
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await this.transactions.model.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 3))::text`;
        return operation(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        // Waiting on the lock can retain a snapshot from before a competing
        // creation committed. Retry its unique-key conflict in a fresh transaction.
        const target = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : undefined;
        const creationRace = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' &&
          Array.isArray(target) && target.length === 2 && target.includes('organizationId') && target.includes('operationKey');
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) ||
            (error.code !== 'P2034' && !creationRace) || attempt === 4) throw error;
      }
    }
    throw Error('Refund request transaction retry exhausted.');
  }
  private publicRequest(row: AiWalletRefundRequest) {
    return { id: row.id, operationKey: row.operationKey, requestedByUserId: row.requestedByUserId,
      requestedNanos: row.requestedNanos.toString(), createdAt: row.createdAt, status: row.status,
      resolvedByUserId: row.resolvedByUserId, resolvedAt: row.resolvedAt };
  }
  private async snapshot(tx: Prisma.TransactionClient, organizationId: string) {
    const holds = await walletHoldSnapshot(tx, organizationId), wallet = holds.wallet;
    const ledger = await tx.aiWalletLedger.groupBy({ by: ['kind'], where: { organizationId }, _sum: { amountNanos: true } });
    const funding = ledger.find(r => r.kind === 'FUNDING')?._sum.amountNanos || 0n;
    const usage = ledger.find(r => r.kind === 'USAGE')?._sum.amountNanos || 0n;
    const balance = wallet?.balanceNanos || 0n, held = wallet?.heldNanos || 0n;
    const reconciled = funding - usage === balance && holds.reconciled;
    return { ...holds, wallet, funding, balance, held, reconciled,
      eligible: wallet?.status === 'ACTIVE' && reconciled ? balance - held : 0n };
  }
  async summary(organizationId: string) {
    return this.transact(organizationId, async tx => {
      const s = await this.snapshot(tx, organizationId);
      const rows = await tx.aiWalletRefundRequest.findMany({ where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
      return { organizationId, creditsExpire: false, purchasedNanos: s.funding.toString(),
        eligibleNanos: s.eligible.toString(), refundHeldNanos: s.refundHeld.toString(),
        usageHeldNanos: s.usageHeld.toString(),
        requiresReconciliation: !s.reconciled || (!!s.wallet && s.wallet.status !== 'ACTIVE'),
        requests: rows.map(r => this.publicRequest(r)) };
    });
  }
  async request(organizationId: string, requestedByUserId: string, operationKey: string) {
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(operationKey) || !requestedByUserId?.trim() || requestedByUserId.length > 200) throw new BadRequestException('Invalid refund request identity.');
    return this.transact(organizationId, async tx => {
      const existing = await tx.aiWalletRefundRequest.findUnique({ where: { organizationId_operationKey: { organizationId, operationKey } } });
      if (existing) return this.publicRequest(existing);
      const s = await this.snapshot(tx, organizationId);
      if (!s.wallet || !s.reconciled || s.wallet.status !== 'ACTIVE') throw new ConflictException('Wallet requires reconciliation.');
      if (s.eligible <= 0n) throw new ConflictException('No unused balance is currently available for a refund request.');
      const row = await tx.aiWalletRefundRequest.create({ data: { organizationId, requestedByUserId, operationKey, requestedNanos: s.eligible } });
      await tx.aiWallet.update({ where: { organizationId }, data: { heldNanos: { increment: s.eligible } } });
      return this.publicRequest(row);
    });
  }
  /** The authorized route chooses the outcome; request ID + outcome is the
   * terminal operation identity. A replay returns the original actor/time. */
  async resolve(organizationId: string, id: string, actorId: string, outcome: 'WITHDRAWN' | 'REJECTED') {
    if (!id?.trim() || id.length > 200 || !actorId?.trim() || actorId.length > 200 ||
        !['WITHDRAWN', 'REJECTED'].includes(outcome)) throw new BadRequestException('Invalid refund transition.');
    return this.transact(organizationId, async tx => {
      const row = await tx.aiWalletRefundRequest.findFirst({ where: { id, organizationId } });
      if (!row) throw new NotFoundException('Refund request not found.');
      if (row.status === outcome) return this.publicRequest(row);
      if (row.status !== 'REQUESTED') throw new ConflictException('Refund request is already resolved.');
      const s = await this.snapshot(tx, organizationId);
      if (!s.wallet || !s.reconciled) throw new ConflictException('Wallet requires reconciliation.');
      await tx.aiWallet.update({ where: { organizationId }, data: { heldNanos: { decrement: row.requestedNanos } } });
      return this.publicRequest(await tx.aiWalletRefundRequest.update({ where: { id }, data: {
        status: outcome, resolvedByUserId: actorId, resolvedAt: new Date() } }));
    });
  }
  // Existing platform-superadmin authority owns this queue. The cursor embeds
  // the ordering tuple so resolving its row between pages cannot skip a page.
  async reviewQueue(cursor?: string) {
    let after: { createdAt: Date; id: string } | undefined;
    if (cursor !== undefined) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 512) throw Error();
        const tuple = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== 'string' ||
            typeof tuple[1] !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(tuple[1]) || new Date(tuple[0]).toISOString() !== tuple[0]) throw Error();
        after = { createdAt: new Date(tuple[0]), id: tuple[1] };
      } catch { throw new BadRequestException('Invalid review cursor.'); }
    }
    const rows = await this.transactions.model.$transaction(tx => tx.aiWalletRefundRequest.findMany({
      where: { status: 'REQUESTED', ...(after ? { OR: [{ createdAt: { gt: after.createdAt } },
        { createdAt: after.createdAt, id: { gt: after.id } }] } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 101 }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const page = rows.slice(0, 100), last = page[page.length - 1];
    return { requests: page.map(r => ({ ...this.publicRequest(r), organizationId: r.organizationId })),
      nextCursor: rows.length > 100 ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url') : null };
  }
}
