import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaTransaction } from '../database/prisma/prisma.service';

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
      catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 4) throw error; }
    }
    throw Error('Refund request transaction retry exhausted.');
  }
  private publicRequest(row: { id: string; operationKey: string; requestedNanos: bigint; createdAt: Date }) {
    return { id: row.id, operationKey: row.operationKey, requestedNanos: row.requestedNanos.toString(), createdAt: row.createdAt, status: 'REQUESTED' as const };
  }
  private async snapshot(tx: Prisma.TransactionClient, organizationId: string) {
    const wallet = await tx.aiWallet.findUnique({ where: { organizationId } });
    const ledger = await tx.aiWalletLedger.groupBy({ by: ['kind'], where: { organizationId }, _sum: { amountNanos: true } });
    const funding = ledger.find(r => r.kind === 'FUNDING')?._sum.amountNanos || 0n;
    const usage = ledger.find(r => r.kind === 'USAGE')?._sum.amountNanos || 0n;
    const refunds = await tx.aiWalletRefundRequest.aggregate({ where: { organizationId }, _sum: { requestedNanos: true } });
    const refundHeld = refunds._sum.requestedNanos || 0n;
    const balance = wallet?.balanceNanos || 0n, held = wallet?.heldNanos || 0n;
    const reconciled = funding - usage === balance && held >= refundHeld && held <= balance;
    return { wallet, funding, balance, held, refundHeld, reconciled,
      eligible: wallet?.status === 'ACTIVE' && reconciled ? balance - held : 0n };
  }
  async summary(organizationId: string) {
    return this.transact(organizationId, async tx => {
      const s = await this.snapshot(tx, organizationId);
      const rows = await tx.aiWalletRefundRequest.findMany({ where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
      return { organizationId, creditsExpire: false, purchasedNanos: s.funding.toString(),
        eligibleNanos: s.eligible.toString(), refundHeldNanos: s.refundHeld.toString(),
        usageHeldNanos: (s.held >= s.refundHeld ? s.held - s.refundHeld : 0n).toString(),
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
  // Existing platform-superadmin authority owns the manual review queue. No
  // approve/reject/pay endpoint is provided by this bounded policy change.
  async reviewQueue() {
    const rows = await this.transactions.model.$transaction(tx => tx.aiWalletRefundRequest.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100 }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return rows.map(r => ({ ...this.publicRequest(r), organizationId: r.organizationId, requestedByUserId: r.requestedByUserId }));
  }
}
