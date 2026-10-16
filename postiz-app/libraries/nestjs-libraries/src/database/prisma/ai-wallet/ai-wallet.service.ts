import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
import { PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

import { PricingQuote, quotedCharge, validatePricingQuote, snapshotFingerprint, usageSnapshot, measuredSnapshot } from '../../../services/ai-wallet-pricing';
import { MeasuredUsage } from '../../../services/ai-wallet-usage';

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

  private storedQuote(reservation: { quoteSnapshot: unknown; quoteFingerprint: string | null; ceilingNanos: bigint }) {
    if (reservation.quoteSnapshot === null && reservation.quoteFingerprint === null) return undefined;
    const quote = validatePricingQuote(reservation.quoteSnapshot);
    if (snapshotFingerprint(quote) !== reservation.quoteFingerprint || quotedCharge(quote) !== reservation.ceilingNanos) {
      throw new Error('Stored quote integrity check failed.');
    }
    return quote;
  }

  async reserve(organizationId: string, operationKey: string, provider: string, model: string, ceilingNanos: bigint, pricingQuote?: PricingQuote) {
    this.enabled();
    [operationKey, provider, model].forEach((value) => this.key(value));
    this.amount(ceilingNanos);
    const quote = pricingQuote ? validatePricingQuote(pricingQuote) : undefined;
    const quoteFingerprint = quote ? snapshotFingerprint(quote) : null;
    if (quote && (quote.provider !== provider || quote.model !== model || quotedCharge(quote) !== ceilingNanos)) {
      throw new Error('Reservation does not match its pricing quote.');
    }
    return this.transact(organizationId, async (tx) => {
      const wallet = await this.wallet(tx, organizationId);
      const existing = await tx.aiWalletReservation.findUnique({
        where: { organizationId_operationKey: { organizationId, operationKey } },
      });
      if (existing) {
        this.storedQuote(existing);
        if (existing.provider !== provider || existing.model !== model || existing.ceilingNanos !== ceilingNanos ||
            existing.quoteFingerprint !== quoteFingerprint) {
          throw new Error('Wallet operation was reused with different parameters.');
        }
        return existing;
      }
      if (wallet.status !== 'ACTIVE') throw new Error('Wallet requires reconciliation.');
      if (wallet.balanceNanos - wallet.heldNanos < ceilingNanos) throw new Error('Insufficient prepaid AI balance.');
      const reservation = await tx.aiWalletReservation.create({
        data: { organizationId, operationKey, provider, model, ceilingNanos,
          ...(quote ? { quoteSnapshot: quote, quoteFingerprint } : {}) },
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
      this.storedQuote(reservation);
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

  async settle(organizationId: string, id: string, chargedNanos: bigint, providerRequestId: string, measured?: MeasuredUsage) {
    this.amount(chargedNanos, true);
    this.key(providerRequestId);
    return this.transact(organizationId, tx => this.settleInTransaction(tx, organizationId, id, chargedNanos, providerRequestId, measured));
  }

  private async settleInTransaction(tx: Prisma.TransactionClient, organizationId: string, id: string,
    chargedNanos: bigint, providerRequestId: string, measured?: MeasuredUsage) {
      const reservation = await this.reservation(tx, organizationId, id);
      if (reservation.providerRequestId && reservation.providerRequestId !== providerRequestId) {
        throw new Error('Provider receipt identity changed.');
      }
      const quote = this.storedQuote(reservation);
      const usage = measured ? usageSnapshot(measured) : undefined;
      const usageFingerprint = usage ? snapshotFingerprint(usage) : null;
      if (quote && (!measured || measured.providerRequestId !== providerRequestId ||
          quotedCharge(quote, measured) !== chargedNanos)) {
        throw new Error('Settlement requires the quoted provider usage.');
      }
      if (reservation.usageFingerprint && reservation.usageFingerprint !== usageFingerprint) {
        throw new Error('Provider usage changed.');
      }
      const usageData = usage ? { usageSnapshot: usage, usageFingerprint } : {};
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
          state: 'UNKNOWN', reportedNanos: chargedNanos, providerRequestId, ...usageData,
        } });
      }
      await tx.aiWallet.update({ where: { organizationId }, data: {
        balanceNanos: { decrement: chargedNanos }, heldNanos: { decrement: reservation.ceilingNanos },
      } });
      if (chargedNanos > 0n) await tx.aiWalletLedger.create({ data: {
        organizationId, externalKey: `usage:${id}`, kind: 'USAGE', amountNanos: chargedNanos, reservationId: id,
      } });
      return tx.aiWalletReservation.update({ where: { id }, data: {
        state: 'SETTLED', chargedNanos, reportedNanos: chargedNanos, providerRequestId, ...usageData,
      } });
  }

  /** Reconciliation uses the persisted quote, including when purchases pause.
   * Only trusted normalized provider receipts may reach this internal method. */
  async reconcileQuoted(organizationId: string, id: string, receipt?: MeasuredUsage) {
    const reservation = await this.transact(organizationId, tx => this.reservation(tx, organizationId, id));
    const quote = this.storedQuote(reservation);
    if (!quote) throw new Error('Reservation has no pricing quote.');
    const usage = receipt ?? (reservation.usageSnapshot ? measuredSnapshot(reservation.usageSnapshot) : undefined);
    if (!usage) throw new Error('Reconciliation requires provider usage.');
    return this.settle(organizationId, id, quotedCharge(quote, usage), usage.providerRequestId, usage);
  }

  async quotedOperation(organizationId: string, operationKey: string) {
    this.key(operationKey);
    return this.transact(organizationId, async tx => {
      const row = await tx.aiWalletReservation.findUnique({ where: { organizationId_operationKey: { organizationId, operationKey } } });
      if (row) this.storedQuote(row);
      return row;
    });
  }

  private async transcription(tx: Prisma.TransactionClient, organizationId: string, reservationId: string,
    transcriptionId: string, generation: number) {
    const reservation = await this.reservation(tx, organizationId, reservationId);
    if (!this.storedQuote(reservation) || reservation.operationKey !== `media-transcription:${transcriptionId}`) {
      throw new Error('Reservation does not own this transcription.');
    }
    const row = await tx.mediaTranscription.findFirst({ where: { id: transcriptionId, generation,
      media: { organizationId, deletedAt: null } } });
    if (!row) throw new Error('Transcription is no longer active.');
    return { reservation, row };
  }

  async dispatchTranscription(organizationId: string, reservationId: string, transcriptionId: string, generation: number) {
    this.enabled();
    return this.transact(organizationId, async tx => {
      const { reservation, row } = await this.transcription(tx, organizationId, reservationId, transcriptionId, generation);
      if (row.status !== 'PROCESSING') throw new Error('Transcription is no longer active.');
      if ((await this.wallet(tx, organizationId)).status !== 'ACTIVE') throw new Error('Wallet requires reconciliation.');
      if (reservation.state !== 'RESERVED') return { dispatch: false, reservation };
      return { dispatch: true, reservation: await tx.aiWalletReservation.update({ where: { id: reservationId }, data: { state: 'DISPATCHED' } }) };
    });
  }

  /** First commit: receipt and recoverable business output together, still held.
   * Text stays on MediaTranscription, never in wallet metadata or ledger. */
  async stageTranscription(organizationId: string, reservationId: string, transcriptionId: string,
    generation: number, text: string, receipt: MeasuredUsage) {
    if (typeof text !== 'string') throw new Error('Invalid transcription result.');
    const usage = usageSnapshot(receipt), usageFingerprint = snapshotFingerprint(usage);
    const resultFingerprint = createHash('sha256').update(text).digest('hex');
    return this.transact(organizationId, async tx => {
      const { reservation, row } = await this.transcription(tx, organizationId, reservationId, transcriptionId, generation);
      quotedCharge(reservation.quoteSnapshot, receipt);
      if (row.status !== 'PROCESSING' || !['DISPATCHED', 'UNKNOWN'].includes(reservation.state) ||
          (reservation.providerRequestId && reservation.providerRequestId !== receipt.providerRequestId) ||
          (reservation.usageFingerprint && reservation.usageFingerprint !== usageFingerprint) ||
          (row.text !== null && row.text !== text) ||
          (reservation.resultFingerprint && reservation.resultFingerprint !== resultFingerprint)) throw new Error('Transcription receipt or result changed.');
      await tx.aiWalletReservation.update({ where: { id: reservationId }, data: { state: 'UNKNOWN',
        providerRequestId: receipt.providerRequestId, usageSnapshot: usage, usageFingerprint, resultFingerprint } });
      await tx.mediaTranscription.update({ where: { id: transcriptionId }, data: { text } });
    });
  }

  /** Second commit: debit and READY become visible atomically. Crash/retry after
   * staging resumes here; it must never invoke the provider again. */
  async finishTranscription(organizationId: string, reservationId: string, transcriptionId: string, generation: number) {
    return this.transact(organizationId, async tx => {
      const { reservation, row } = await this.transcription(tx, organizationId, reservationId, transcriptionId, generation);
      if (row.status === 'READY' && reservation.state === 'SETTLED') return reservation;
      if (row.status !== 'PROCESSING' || row.text === null || !reservation.usageSnapshot) {
        throw new Error('Transcription has no staged provider result.');
      }
      if (createHash('sha256').update(row.text).digest('hex') !== reservation.resultFingerprint) {
        throw new Error('Staged transcription result integrity check failed.');
      }
      const usage = measuredSnapshot(reservation.usageSnapshot);
      const settled = await this.settleInTransaction(tx, organizationId, reservationId,
        quotedCharge(reservation.quoteSnapshot, usage), usage.providerRequestId, usage);
      if (settled.state === 'SETTLED') await tx.mediaTranscription.update({ where: { id: transcriptionId }, data: {
        status: 'READY', text: row.text || null, completedAt: new Date(), errorCode: null, errorMessage: null,
      } });
      return settled;
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

  async bindTopupSession(organizationId: string, id: string, sessionId: string) {
    this.key(id); this.key(sessionId);
    return this.transact(organizationId, async (tx) => {
      const topup = await tx.aiWalletTopup.findFirst({ where: { id, organizationId } });
      if (!topup) throw new Error('Topup not found.');
      if (topup.sessionId === sessionId) return topup;
      if (topup.sessionId) throw new Error('Topup session identity changed.');
      return tx.aiWalletTopup.update({ where: { id }, data: { sessionId } });
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
          topup.sessionId !== event.sessionId ||
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
