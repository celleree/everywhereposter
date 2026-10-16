import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
import { PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const MAX_NANOS = 9223372036854775807n;
const NANOS_PER_CENT = 10000000n;

type VerifiedTopupEvent = {
  eventId: string;
  organizationId: string;
  topupId: string;
  sessionId: string;
  paymentId: string | null;
  customerId: string;
  amountCents: number;
  currency: string;
  mode: 'payment';
  paymentStatus: 'paid' | 'unpaid';
};

/** Ledger primitives only. Public purchase/dispatch adapters must enforce flags,
 * trusted offer configuration and Stripe signature verification. No paid calls,
 * commercial pack defaults, quota conversion or automatic trial grants here. */
@Injectable()
export class AiWalletService {
  constructor(private readonly transactions: PrismaTransaction) {}

  private enabled() {
    if (!isBillingEnabled() || process.env.AI_WALLET_ENABLED?.trim().toLowerCase() !== 'true') {
      throw new Error('Prepaid AI billing is disabled.');
    }
  }

  private amount(value: bigint, zero = false) {
    if (typeof value !== 'bigint' || value < (zero ? 0n : 1n) || value > MAX_NANOS) {
      throw new Error('Invalid wallet amount.');
    }
  }

  private key(value: string) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) {
      throw new Error('Invalid wallet operation identity.');
    }
  }

  private async transact<T>(organizationId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    this.key(organizationId);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.transactions.model.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 3))::text`;
          return operation(tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 4) throw error;
      }
    }
    throw new Error('Wallet transaction retry exhausted.');
  }

  private wallet(tx: Prisma.TransactionClient, organizationId: string) {
    return tx.aiWallet.upsert({ where: { organizationId }, create: { organizationId }, update: {} });
  }

  private async reservation(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    const reservation = await tx.aiWalletReservation.findFirst({ where: { id, organizationId } });
    if (!reservation) throw new Error('Wallet reservation not found.');
    return reservation;
  }

  async reserve(organizationId: string, operationKey: string, provider: string, model: string, ceilingNanos: bigint) {
    this.enabled();
    [operationKey, provider, model].forEach((value) => this.key(value));
    this.amount(ceilingNanos);
    return this.transact(organizationId, async (tx) => {
      const wallet = await this.wallet(tx, organizationId);
      const existing = await tx.aiWalletReservation.findUnique({
        where: { organizationId_operationKey: { organizationId, operationKey } },
      });
      if (existing) {
        if (existing.provider !== provider || existing.model !== model || existing.ceilingNanos !== ceilingNanos) {
          throw new Error('Wallet operation was reused with different parameters.');
        }
        return existing;
      }
      if (wallet.status !== 'ACTIVE') throw new Error('Wallet requires reconciliation.');
      if (wallet.balanceNanos - wallet.heldNanos < ceilingNanos) throw new Error('Insufficient prepaid AI balance.');
      const reservation = await tx.aiWalletReservation.create({
        data: { organizationId, operationKey, provider, model, ceilingNanos },
      });
      await tx.aiWallet.update({ where: { organizationId }, data: { heldNanos: { increment: ceilingNanos } } });
      return reservation;
    });
  }

  async dispatch(organizationId: string, id: string) {
    this.enabled();
    return this.transact(organizationId, async (tx) => {
      const wallet = await this.wallet(tx, organizationId);
      if (wallet.status !== 'ACTIVE') throw new Error('Wallet requires reconciliation.');
      const reservation = await this.reservation(tx, organizationId, id);
      if (reservation.state !== 'RESERVED') return { dispatch: false, reservation };
      return { dispatch: true, reservation: await tx.aiWalletReservation.update({
        where: { id }, data: { state: 'DISPATCHED' },
      }) };
    });
  }

  async cancelBeforeDispatch(organizationId: string, id: string) {
    return this.transact(organizationId, async (tx) => {
      const reservation = await this.reservation(tx, organizationId, id);
      if (reservation.state === 'RELEASED' || reservation.state === 'SETTLED') return reservation;
      if (reservation.state !== 'RESERVED') throw new Error('Dispatched usage requires a provider receipt.');
      await tx.aiWallet.update({ where: { organizationId }, data: { heldNanos: { decrement: reservation.ceilingNanos } } });
      return tx.aiWalletReservation.update({ where: { id }, data: { state: 'RELEASED' } });
    });
  }

  async markUnknown(organizationId: string, id: string, providerRequestId?: string) {
    if (providerRequestId !== undefined) this.key(providerRequestId);
    return this.transact(organizationId, async (tx) => {
      const reservation = await this.reservation(tx, organizationId, id);
      if (reservation.state === 'SETTLED' || reservation.state === 'RELEASED') return reservation;
      if (reservation.state !== 'DISPATCHED' && reservation.state !== 'UNKNOWN') {
        throw new Error('Wallet operation has not been dispatched.');
      }
      if (reservation.providerRequestId && providerRequestId && reservation.providerRequestId !== providerRequestId) {
        throw new Error('Provider receipt identity changed.');
      }
      return tx.aiWalletReservation.update({ where: { id }, data: {
        state: 'UNKNOWN', ...(providerRequestId ? { providerRequestId } : {}),
      } });
    });
  }

  async settle(organizationId: string, id: string, chargedNanos: bigint, providerRequestId: string) {
    this.amount(chargedNanos, true);
    this.key(providerRequestId);
    return this.transact(organizationId, async (tx) => {
      const reservation = await this.reservation(tx, organizationId, id);
      if (reservation.providerRequestId && reservation.providerRequestId !== providerRequestId) {
        throw new Error('Provider receipt identity changed.');
      }
      if (reservation.state === 'SETTLED') {
        if (reservation.chargedNanos !== chargedNanos) throw new Error('Settled usage amount changed.');
        return reservation;
      }
      if (reservation.state !== 'DISPATCHED' && reservation.state !== 'UNKNOWN') {
        throw new Error('Wallet operation has no dispatch to settle.');
      }
      if (chargedNanos > reservation.ceilingNanos) {
        await tx.aiWallet.update({ where: { organizationId }, data: { status: 'REVIEW' } });
        return tx.aiWalletReservation.update({ where: { id }, data: {
          state: 'UNKNOWN', reportedNanos: chargedNanos, providerRequestId,
        } });
      }
      await tx.aiWallet.update({ where: { organizationId }, data: {
        balanceNanos: { decrement: chargedNanos }, heldNanos: { decrement: reservation.ceilingNanos },
      } });
      if (chargedNanos > 0n) await tx.aiWalletLedger.create({ data: {
        organizationId, externalKey: `usage:${id}`, kind: 'USAGE', amountNanos: chargedNanos, reservationId: id,
      } });
      return tx.aiWalletReservation.update({ where: { id }, data: {
        state: 'SETTLED', chargedNanos, reportedNanos: chargedNanos, providerRequestId,
      } });
    });
  }

  /** Internal server-created intent. The eventual Checkout adapter must accept
   * only configured offers, never arbitrary client amounts or credit grants. */
  async createTopup(organizationId: string, operationKey: string, customerId: string, amountCents: number) {
    this.enabled();
    [operationKey, customerId].forEach((value) => this.key(value));
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 2147483647) {
      throw new Error('Invalid prepaid payment amount.');
    }
    return this.transact(organizationId, async (tx) => {
      const wallet = await this.wallet(tx, organizationId);
      if (wallet.status !== 'ACTIVE') throw new Error('Wallet requires reconciliation.');
      const existing = await tx.aiWalletTopup.findUnique({ where: {
        organizationId_operationKey: { organizationId, operationKey },
      } });
      if (existing) {
        if (existing.customerId !== customerId || existing.amountCents !== amountCents) {
          throw new Error('Topup identity was reused with different parameters.');
        }
        return existing;
      }
      return tx.aiWalletTopup.create({ data: { organizationId, operationKey, customerId, amountCents, currency: 'usd' } });
    });
  }

  /** Only a signature-verified, normalized Stripe Checkout event may call this.
   * Credit comes from our persisted intent, never from webhook credit metadata. */
  async applyVerifiedTopupEvent(event: VerifiedTopupEvent) {
    [event.eventId, event.topupId, event.sessionId, event.customerId].forEach((value) => this.key(value));
    if (event.paymentId !== null) this.key(event.paymentId);
    const fingerprint = createHash('sha256').update(JSON.stringify([
      event.organizationId, event.topupId, event.sessionId, event.paymentId,
      event.customerId, event.amountCents, event.currency, event.mode, event.paymentStatus,
    ])).digest('hex');
    return this.transact(event.organizationId, async (tx) => {
      const previous = await tx.aiWalletPaymentEvent.findUnique({ where: { eventId: event.eventId } });
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('Payment event identity changed.');
        return previous;
      }
      const topup = await tx.aiWalletTopup.findFirst({ where: { id: event.topupId, organizationId: event.organizationId } });
      if (!topup || topup.customerId !== event.customerId || topup.amountCents !== event.amountCents ||
          topup.currency !== event.currency || event.mode !== 'payment' ||
          (topup.sessionId && topup.sessionId !== event.sessionId) ||
          (event.paymentStatus === 'paid' && topup.paymentId && topup.paymentId !== event.paymentId)) {
        throw new Error('Payment does not match the server-created topup.');
      }
      if (event.paymentStatus !== 'paid' && event.paymentStatus !== 'unpaid') throw new Error('Invalid payment state.');
      if (event.paymentStatus === 'paid' && !event.paymentId) throw new Error('Paid topup is missing payment identity.');
      const credited = event.paymentStatus === 'paid' && topup.fundedAt === null;
      if (credited) {
        const amountNanos = BigInt(topup.amountCents) * NANOS_PER_CENT;
        await tx.aiWallet.update({ where: { organizationId: event.organizationId }, data: { balanceNanos: { increment: amountNanos } } });
        await tx.aiWalletTopup.update({ where: { id: topup.id }, data: {
          fundedAt: new Date(), sessionId: event.sessionId, paymentId: event.paymentId,
        } });
        await tx.aiWalletLedger.create({ data: {
          organizationId: event.organizationId, externalKey: `payment:${event.paymentId}`,
          kind: 'FUNDING', amountNanos, topupId: topup.id,
        } });
      }
      return tx.aiWalletPaymentEvent.create({ data: {
        eventId: event.eventId, topupId: topup.id, organizationId: event.organizationId, fingerprint, credited,
      } });
    });
  }
}
