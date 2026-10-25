import { ConflictException } from '@nestjs/common';
import { AiWallet, Prisma } from '@prisma/client';

/** Call within a wallet-locked transaction for mutations, or one consistent
 * snapshot for display. Terminal reservations retain no part of their ceiling. */
export async function walletHoldSnapshot(tx: Prisma.TransactionClient, organizationId: string, wallet?: AiWallet | null) {
  const current = wallet === undefined ? await tx.aiWallet.findUnique({ where: { organizationId } }) : wallet;
  const reservations = await tx.aiWalletReservation.groupBy({ by: ['state'], where: { organizationId },
    _sum: { ceilingNanos: true }, _count: { _all: true, chargedNanos: true } });
  const requests = await tx.aiWalletRefundRequest.groupBy({ by: ['status'], where: { organizationId }, _sum: { requestedNanos: true } });
  let usageHeld = 0n, refundHeld = 0n, supported = true;
  for (const row of reservations) {
    switch (row.state) {
      case 'RESERVED': case 'DISPATCHED': case 'UNKNOWN':
        supported &&= row._count.chargedNanos === 0;
        usageHeld += row._sum.ceilingNanos || 0n; break;
      case 'SETTLED': supported &&= row._count.chargedNanos === row._count._all; break;
      case 'RELEASED': supported &&= row._count.chargedNanos === 0; break;
      default: supported = false;
    }
  }
  for (const row of requests) {
    if (row.status === 'REQUESTED') refundHeld += row._sum.requestedNanos || 0n;
    else if (row.status !== 'WITHDRAWN' && row.status !== 'REJECTED' && row.status !== 'REFUNDED') supported = false;
  }
  const held = current?.heldNanos || 0n, balance = current?.balanceNanos || 0n;
  return { wallet: current, usageHeld, refundHeld,
    reconciled: supported && held === usageHeld + refundHeld && held >= 0n && held <= balance };
}

export async function assertWalletHolds(tx: Prisma.TransactionClient, organizationId: string, wallet?: AiWallet | null) {
  if (!(await walletHoldSnapshot(tx, organizationId, wallet)).reconciled) throw new ConflictException('Wallet requires reconciliation.');
}
