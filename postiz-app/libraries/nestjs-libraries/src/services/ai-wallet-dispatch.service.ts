import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { MeasuredUsage } from './ai-wallet-usage';

type PendingUsage = { provider: string; model: string; providerRequestId: string; pending: true };
type Measurement = MeasuredUsage | PendingUsage;
type Quote = { provider: string; model: string; ceilingNanos: bigint };
/** Internal adapter for trusted server callers. Never accepts client quotes/rates.
 * No automatic retries, fallback dispatches or release after any dispatch claim.
 * Paid production call sites remain disconnected until durable pricing is approved. */
@Injectable()
export class AiWalletDispatchService {
  constructor(private readonly wallet: AiWalletService) {}

  async run<T>(organizationId: string, operationKey: string, quote: Quote,
    invoke: () => Promise<T>, measure: (result: T) => Measurement,
    price: (usage: MeasuredUsage) => bigint) {
    const reservation = await this.wallet.reserve(organizationId, operationKey,
      quote.provider, quote.model, quote.ceilingNanos);
    const claim = await this.wallet.dispatch(organizationId, reservation.id);
    if (!claim.dispatch) return { reservation: claim.reservation, result: undefined };
    let receipt: Measurement | undefined;
    try {
      const result = await invoke();
      receipt = measure(result);
      if (receipt.provider !== reservation.provider || receipt.model !== reservation.model) {
        receipt = undefined;
        throw Error('Provider receipt does not match the reserved model.');
      }
      if ('pending' in receipt) {
        return { reservation: await this.wallet.markUnknown(organizationId, reservation.id, receipt.providerRequestId), result: undefined };
      }
      const settled = await this.wallet.settle(organizationId, reservation.id,
        price(receipt), receipt.providerRequestId);
      return { reservation: settled, result: settled.state === 'SETTLED' ? result : undefined };
    } catch {
      // A timeout, invalid usage or failed settlement may already have incurred cost.
      // If this write fails, the durable DISPATCHED state still retains the hold.
      try {
        return { reservation: await this.wallet.markUnknown(organizationId, reservation.id, receipt?.providerRequestId), result: undefined };
      } catch (error) {
        // A receipt already bound to another dispatch must not be attached again.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        return { reservation: await this.wallet.markUnknown(organizationId, reservation.id), result: undefined };
      }
    }
  }
}
