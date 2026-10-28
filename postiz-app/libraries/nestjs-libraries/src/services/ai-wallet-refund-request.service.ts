import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AiWalletRefundRequest, Prisma, AiWalletRefundReconciliation } from '@prisma/client';
import { PrismaTransaction } from '../database/prisma/prisma.service';
import Stripe from 'stripe';
import { createHash, randomUUID } from 'crypto';
import { walletHoldSnapshot } from './ai-wallet-holds';

class RefundIdentityChanged extends Error {}

/** Server-only normalized read receipt. Never accepted from the HTTP review body.
 * The operator adapter verifies the current Stripe account before issuing reads. */
export interface TestRefundProviderProof {
  accountId: string;
  observedAt: number;
  charge: { id: string; paymentId: string; customerId: string; amount: number;
    amountRefunded: number; currency: string; livemode: boolean; paid: boolean;
    captured: boolean; refunded: boolean; disputed: boolean };
  refunds: { object: string; hasMore: boolean; data: { id: string; paymentId: string;
    chargeId: string; amount: number; currency: string; status: string }[] };
}

/** Durable manual-review requests only. Never expires value or calls a payment,
 * email or refund provider. Request holds share the spend serialization lock. */
@Injectable()
export class AiWalletRefundRequestService {
  constructor(private readonly transactions: PrismaTransaction) {}
  private async transact<T>(organizationId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>, relatedOrganizations: string[] = []): Promise<T> {
    if (!organizationId?.trim() || organizationId.length > 200) throw new BadRequestException('Invalid organization.');
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await this.transactions.model.$transaction(async tx => {
        for (const lockedOrg of [...new Set([organizationId, ...relatedOrganizations])].sort())
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockedOrg}, 3))::text`;
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
  private async terminalTime(tx: Prisma.TransactionClient, requestId: string): Promise<Date> {
    // Wall clocks can step backward; transaction-start time can also be stale.
    // Preserve logical ordering against immutable creation without changing history.
    const [row] = await tx.$queryRaw<{ resolvedAt: Date }[]>`
      SELECT GREATEST("createdAt", (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)) AS "resolvedAt"
      FROM "AiWalletRefundRequest" WHERE "id" = ${requestId}`;
    if (!row) throw new NotFoundException('Refund request not found.');
    return row.resolvedAt;
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
    const reversal = ledger.find(r => r.kind === 'REVERSAL')?._sum.amountNanos || 0n;
    const reconciled = funding - usage - reversal === balance && holds.reconciled;
    return { ...holds, wallet, funding, balance, held, reconciled,
      eligible: wallet?.status === 'ACTIVE' && reconciled ? balance - held : 0n };
  }
  async summary(organizationId: string) {
    return this.transact(organizationId, async tx => {
      const s = await this.snapshot(tx, organizationId);
      const rows = await tx.aiWalletRefundRequest.findMany({ where: { organizationId }, include: { reconciliation: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
      return { organizationId, creditsExpire: false, purchasedNanos: s.funding.toString(),
        eligibleNanos: s.eligible.toString(), refundHeldNanos: s.refundHeld.toString(),
        usageHeldNanos: s.usageHeld.toString(),
        requiresReconciliation: !s.reconciled || (!!s.wallet && s.wallet.status !== 'ACTIVE'),
        requests: rows.map(r => ({ ...this.publicRequest(r), testReconciliation: r.reconciliation ? { state: r.reconciliation.state, reviewedAt: r.reconciliation.reviewedAt } : null })) };
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
      if (await tx.aiWalletRefundReconciliation.findUnique({ where: { requestId: id } })) throw new ConflictException('Test refund reconciliation retains this hold.');
      const s = await this.snapshot(tx, organizationId);
      if (!s.wallet || !s.reconciled) throw new ConflictException('Wallet requires reconciliation.');
      await tx.aiWallet.update({ where: { organizationId }, data: { heldNanos: { decrement: row.requestedNanos } } });
      return this.publicRequest(await tx.aiWalletRefundRequest.update({ where: { id }, data: {
        status: outcome, resolvedByUserId: actorId, resolvedAt: await this.terminalTime(tx, id) } }));
    });
  }
  private assertTestRefunds() {
    if (process.env.AI_WALLET_TEST_REFUNDS_ENABLED?.trim().toLowerCase() !== 'true') throw new ServiceUnavailableException('Test refund reconciliation is disabled.');
    if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || '')) throw new ServiceUnavailableException('Test refund reconciliation requires a Stripe test account.');
  }
  private async unusedTopup(tx: Prisma.TransactionClient, organizationId: string, requestId: string, topupId: string) {
    const held = await this.fullyHeldTopup(tx, organizationId, requestId, topupId);
    if (held.wallet?.status !== 'ACTIVE')
      throw new ConflictException('A single fully unused identifiable top-up is required.');
    return held;
  }
  // Late review may debit only after independently classifying persisted history.
  // Spending and ordinary webhook success continue to require ACTIVE above.
  private async fullyHeldTopup(tx: Prisma.TransactionClient, organizationId: string, requestId: string, topupId: string) {
    const s = await this.snapshot(tx, organizationId);
    const row = await tx.aiWalletRefundRequest.findFirst({ where: { id: requestId, organizationId } });
    const topup = await tx.aiWalletTopup.findFirst({ where: { id: topupId, organizationId } });
    const entries = await tx.aiWalletLedger.findMany({ where: { organizationId } });
    if (!s.reconciled || !['ACTIVE', 'REVIEW'].includes(s.wallet?.status || '') || row?.status !== 'REQUESTED' || !topup?.fundedAt || !topup.paymentId ||
        !topup.sessionId || topup.currency !== 'usd' || s.balance !== BigInt(topup.amountCents) * 10000000n ||
        s.held !== s.balance || row.requestedNanos !== s.balance ||
        entries.length !== 1 || entries[0].kind !== 'FUNDING' || entries[0].topupId !== topupId ||
        entries[0].externalKey !== `payment:${topup.paymentId}` || entries[0].amountNanos !== s.balance ||
        await tx.aiWalletTopup.count({ where: { organizationId, fundedAt: { not: null } } }) !== 1 ||
        await tx.aiWalletReservation.count({ where: { organizationId } }) !== 0) {
      throw new ConflictException('A single fully unused identifiable top-up is required.');
    }
    return { row, topup, wallet: s.wallet };
  }
  /** Platform-superadmin route only. This binds reviewed synthetic evidence; it
   * never creates a refund, contacts Stripe, or approves a production policy. */
  async reviewTestTopup(organizationId: string, requestId: string, actorId: string,
    expected: { topupId: string; chargeId: string; refundId: string }, providerProof?: TestRefundProviderProof) {
    this.assertTestRefunds();
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200 ||
        !actorId?.trim() || actorId.length > 200 || !expected || typeof expected.topupId !== 'string' || expected.topupId.length > 200 ||
        !/^ch_[a-zA-Z0-9_-]{1,190}$/.test(expected.chargeId) || !/^re_[a-zA-Z0-9_-]{1,190}$/.test(expected.refundId)) throw new BadRequestException('Invalid test review identity.');
    return this.transact(organizationId, async tx => {
      const previous = await tx.aiWalletRefundReconciliation.findUnique({ where: { requestId } });
      if (previous) {
        if (previous.organizationId !== organizationId || previous.topupId !== expected.topupId ||
            previous.chargeId !== expected.chargeId || previous.refundId !== expected.refundId) throw new ConflictException('Test review identity changed.');
        return { state: previous.state, reviewedAt: previous.reviewedAt };
      }
      const topup = await tx.aiWalletTopup.findFirst({ where: { id: expected.topupId, organizationId } });
      if (!topup?.paymentId) throw new ConflictException('A single fully unused identifiable top-up is required.');
      await this.lockRefundIdentities(tx, topup.paymentId, expected.chargeId, expected.refundId);
      const identities = await this.refundIdentities(tx, topup.paymentId, expected.chargeId, expected.refundId);
      if (identities.organizations.some(id => id !== organizationId)) throw new ConflictException('Test review identity changed.');
      const history = await tx.aiWalletRefundEvent.findMany({ where: { OR: [
        { organizationId }, { paymentId: topup.paymentId },
        { evidence: { path: ['paymentId'], equals: topup.paymentId } },
        { evidence: { path: ['chargeId'], equals: expected.chargeId } },
        { evidence: { path: ['id'], equals: expected.refundId } },
        { evidence: { path: ['refundIds'], array_contains: [expected.refundId] } },
        { evidence: { path: ['organizations'], array_contains: [organizationId] } }] } });
      const late = history.length > 0;
      const held = late ? await this.fullyHeldTopup(tx, organizationId, requestId, expected.topupId)
        : await this.unusedTopup(tx, organizationId, requestId, expected.topupId);
      if (providerProof) this.validateProviderProof(providerProof, held.topup, expected);
      if (providerProof && !late) throw new ConflictException('Signed refund history is required.');
      if (late) {
        let succeeded = false;
        for (const audit of history) {
          const e = audit.evidence as any;
          const exact = e && Array.isArray(e.organizations) && e.organizations.length === 1 && e.organizations.every((id: unknown) => id === organizationId) &&
            audit.organizationId === organizationId && audit.outcome === 'UNCERTAIN' && audit.paymentId === topup.paymentId &&
            e.paymentId === topup.paymentId && e.chargeId === expected.chargeId &&
            e.amount === topup.amountCents && e.currency === topup.currency &&
            audit.createdAt >= held.row.createdAt && audit.createdAt >= topup.fundedAt!;
          const refund = ['refund.created', 'refund.updated'].includes(e?.type) && e.object === 'refund' &&
            e.id === expected.refundId && ['pending', 'succeeded'].includes(e.status);
          const complete = e?.refundsShape !== 'MALFORMED' && e?.refundsHasMore === false && Array.isArray(e.refundIds) &&
            e.refundIds.length === 1 && e.refundIds[0] === expected.refundId;
          // Pre-existing rows lost the distinction between absent and malformed.
          // A fresh authoritative list can resolve only null/null summaries; known
          // pagination, malformed lists and explicit contradictions still block.
          const absent = providerProof && e?.refundIds === null && e.refundsHasMore === null &&
            (e.refundsShape === undefined || e.refundsShape === 'ABSENT');
          const charge = e?.type === 'charge.refunded' && e.object === 'charge' && e.id === expected.chargeId &&
            e.amountRefunded === topup.amountCents && (complete || absent);
          if (!exact || (!refund && !charge)) throw new ConflictException('Prior refund/dispute evidence requires reconciliation.');
          succeeded ||= refund && e.status === 'succeeded';
        }
        if (!succeeded) throw new ConflictException('Prior refund/dispute evidence requires reconciliation: signed terminal success is required.');
      }
      if (providerProof) {
        // Append a distinct API-read receipt atomically with the binding/debit.
        // Original signed webhook rows remain byte-for-byte unchanged.
        const evidence = JSON.parse(JSON.stringify({ source: 'STRIPE_TEST_API_READ', accountId: providerProof.accountId, observedAt: providerProof.observedAt,
          charge: Object.fromEntries(['id', 'paymentId', 'customerId', 'amount', 'amountRefunded', 'currency',
            'livemode', 'paid', 'captured', 'refunded', 'disputed'].map(k => [k, (providerProof.charge as any)[k]])),
          refunds: { object: 'list', hasMore: false, data: providerProof.refunds.data.map(r => ({
            id: r.id, paymentId: r.paymentId, chargeId: r.chargeId, amount: r.amount, currency: r.currency, status: r.status })) },
          organizations: [organizationId], paymentId: topup.paymentId,
          chargeId: expected.chargeId, refundId: expected.refundId, requestId, topupId: topup.id }));
        await tx.aiWalletRefundEvent.create({ data: { eventId: `provider-read:${randomUUID()}`,
          organizationId, paymentId: topup.paymentId, outcome: 'VERIFIED_PROVIDER_READ', evidence,
          fingerprint: createHash('sha256').update(JSON.stringify(evidence)).digest('hex') } });
      }
      const row = await tx.aiWalletRefundReconciliation.create({ data: { requestId, organizationId, topupId: topup.id,
        paymentId: topup.paymentId, chargeId: expected.chargeId, refundId: expected.refundId,
        amountCents: topup.amountCents, currency: topup.currency, reviewedByUserId: actorId } });
      if (late) {
        await this.debitRefund(tx, row);
        await tx.aiWalletRefundReconciliation.update({ where: { requestId }, data: { state: 'SUCCEEDED' } });
        return { state: 'SUCCEEDED', reviewedAt: row.reviewedAt };
      }
      return { state: row.state, reviewedAt: row.reviewedAt };
    });
  }
  private validateProviderProof(proof: TestRefundProviderProof, topup: { paymentId: string | null;
    customerId: string; amountCents: number; currency: string; fundedAt: Date | null },
    expected: { chargeId: string; refundId: string }) {
    const c = proof?.charge, list = proof?.refunds, r = list?.data?.[0];
    if (!/^acct_[A-Za-z0-9]{1,100}$/.test(proof?.accountId || '') ||
        !Number.isSafeInteger(proof?.observedAt) || proof.observedAt > Date.now() ||
        Date.now() - proof.observedAt > 30000 || proof.observedAt < topup.fundedAt!.getTime() ||
        c?.id !== expected.chargeId || c.paymentId !== topup.paymentId || c.customerId !== topup.customerId ||
        c.amount !== topup.amountCents || c.amountRefunded !== topup.amountCents || c.currency !== topup.currency ||
        c.livemode !== false || c.paid !== true || c.captured !== true || c.refunded !== true || c.disputed !== false ||
        list?.object !== 'list' || list.hasMore !== false || !Array.isArray(list.data) || list.data.length !== 1 ||
        r?.id !== expected.refundId || r.chargeId !== expected.chargeId || r.paymentId !== topup.paymentId ||
        r.amount !== topup.amountCents || r.currency !== topup.currency || r.status !== 'succeeded') {
      throw new ConflictException('Complete current-account test refund proof is required.');
    }
  }
  /** Signature verification is mandatory in the caller. Look up the funded
   * payment independently of metadata. Unmatched payment signals are quarantined without touching subscription state. */
  async handleVerifiedRefundEvent(event: Stripe.Event) {
    if (process.env.AI_WALLET_TEST_REFUNDS_ENABLED?.trim().toLowerCase() !== 'true') return { ok: true };
    this.assertTestRefunds();
    if (event.livemode !== false || event.account) throw new BadRequestException('Live or Connect refund events are not supported.');
    const object = event.data.object as any;
    const id = (value: any): string | null => typeof value === 'string' ? value : value?.id || null;
    const paymentId = id(object.payment_intent), chargeId = object.object === 'charge' ? object.id : id(object.charge);
    const refundIds = Array.isArray(object.refunds?.data)
      ? object.refunds.data.map((r: any) => typeof r?.id === 'string' ? r.id : null) : null;
    const relatedRefundIds: string[] = refundIds?.filter((value: unknown): value is string => typeof value === 'string') || [];
    const fingerprint = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    // Resolve again after shared identity locks. A new binding may implicate an
    // additional wallet; restart with its complete sorted lock set before writes.
    for (let attempt = 0; attempt < 5; attempt++) {
      const initial = await this.transactions.model.$transaction(
        tx => this.refundIdentities(tx, paymentId, chargeId, object.id, relatedRefundIds),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      const operation = async (tx: Prisma.TransactionClient) => {
        await this.lockRefundIdentities(tx, paymentId, chargeId, object.id, relatedRefundIds);
        const current = await this.refundIdentities(tx, paymentId, chargeId, object.id, relatedRefundIds);
        if (current.topup?.id !== initial.topup?.id || !!current.topup?.fundedAt !== !!initial.topup?.fundedAt ||
            JSON.stringify(current.organizations) !== JSON.stringify(initial.organizations)) throw new RefundIdentityChanged();
        const { topup, organizations } = current;
        const evidence = { organizations, type: event.type, object: object.object ?? null, id: object.id ?? null, paymentId, chargeId,
          amount: object.amount ?? null, amountRefunded: object.amount_refunded ?? null, currency: object.currency ?? null,
          status: object.status ?? null, refundIds,
          refundsShape: object.refunds == null ? 'ABSENT' :
            (object.refunds?.object === 'list' && Array.isArray(object.refunds.data) &&
              typeof object.refunds.has_more === 'boolean' ? 'LIST' : 'MALFORMED'),
          refundsHasMore: typeof object.refunds?.has_more === 'boolean' ? object.refunds.has_more : null };
        const organizationId = topup?.fundedAt ? topup.organizationId : null;
        const previous = await tx.aiWalletRefundEvent.findUnique({ where: { eventId: event.id } });
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new ConflictException('Refund event identity changed.');
          return { ok: true };
        }
        if (!organizationId) {
          if (paymentId || chargeId || object.id) await tx.aiWalletRefundEvent.create({ data: {
            eventId: event.id, paymentId, fingerprint, evidence, outcome: 'UNMATCHED' } });
          return { ok: true };
        }
        const reviewed = await tx.aiWalletRefundReconciliation.findUnique({ where: { topupId: topup!.id } });
        let outcome = 'UNCERTAIN';
        // charge.refunded is informational only: a charge summary cannot prove an
        // individual refund succeeded. Await the separate matching Refund object.
        const refund = ['refund.created', 'refund.updated', 'refund.failed'].includes(event.type) && object.object === 'refund';
        const matches = reviewed && paymentId === reviewed.paymentId && chargeId === reviewed.chargeId &&
          (!refund || (object.id === reviewed.refundId && object.amount === reviewed.amountCents && object.currency === reviewed.currency));
        if (organizations.length > 1 || reviewed?.state === 'UNCERTAIN' ||
            (refund && reviewed?.state === 'FAILED' && object.status === 'succeeded') ||
            (event.type === 'refund.failed' && object.status !== 'failed')) {
          outcome = 'UNCERTAIN';
        } else if (refund && matches) {
          if (object.status === 'succeeded') {
            const reversal = await tx.aiWalletLedger.findUnique({ where: { refundRequestId: reviewed.requestId } });
            if (reversal) outcome = reviewed.state === 'SUCCEEDED' ? 'SUCCEEDED' : 'UNCERTAIN';
            else {
              try { await this.unusedTopup(tx, organizationId, reviewed.requestId, reviewed.topupId); outcome = 'SUCCEEDED'; }
              catch (error) { if (!(error instanceof ConflictException)) throw error; }
              if (outcome === 'SUCCEEDED') {
                await this.debitRefund(tx, reviewed);
              }
            }
          } else if (['failed', 'canceled'].includes(object.status)) outcome = reviewed.state === 'SUCCEEDED' ? 'UNCERTAIN' : 'FAILED';
          else if (object.status === 'pending') outcome = ['SUCCEEDED', 'FAILED'].includes(reviewed.state) ? reviewed.state : 'PENDING';
        } else if (event.type === 'charge.refunded' && object.object === 'charge' && matches &&
            object.amount === reviewed.amountCents && object.amount_refunded === reviewed.amountCents && object.currency === reviewed.currency &&
            object.refunds?.has_more === false && refundIds?.length === 1 && refundIds[0] === reviewed.refundId) {
          outcome = reviewed.state;
        }
        if (outcome === 'UNCERTAIN') {
          await tx.aiWallet.updateMany({ where: { organizationId: { in: organizations } }, data: { status: 'REVIEW' } });
          await tx.aiWalletRefundReconciliation.updateMany({ where: { organizationId: { in: organizations } }, data: { state: 'UNCERTAIN' } });
        }
        if (reviewed) await tx.aiWalletRefundReconciliation.update({ where: { requestId: reviewed.requestId }, data: { state: outcome } });
        await tx.aiWalletRefundEvent.create({ data: { eventId: event.id, organizationId, paymentId, fingerprint, evidence, outcome } });
        return { ok: true };
      };
      try {
        return initial.topup?.fundedAt
          ? await this.transact(initial.topup.organizationId, operation, initial.organizations)
          : await this.transactions.model.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof RefundIdentityChanged) &&
            (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034')) throw error;
        if (attempt === 4) throw error;
      }
    }
    throw Error('Refund identity transaction retry exhausted.');
  }
  private async lockRefundIdentities(tx: Prisma.TransactionClient, paymentId: string | null, chargeId: string | null, refundId: string | null, relatedRefundIds: string[] = []) {
    // Funding uses the bare payment key. All wallet namespace3 locks precede
    // namespace4; orphan ingestion takes namespace4 only and never adds wallets.
    const keys = [paymentId, chargeId && `charge:${chargeId}`, ...[refundId, ...relatedRefundIds].filter(Boolean).map(id => `refund:${id}`)].filter((k): k is string => !!k);
    for (const key of [...new Set(keys)].sort())
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 4))::text`;
  }
  private async refundIdentities(tx: Prisma.TransactionClient, paymentId: string | null, chargeId: string | null, refundId: string | null, relatedRefundIds: string[] = []) {
    let topup = paymentId ? await tx.aiWalletTopup.findUnique({ where: { paymentId } }) : null;
    const bindings = await tx.aiWalletRefundReconciliation.findMany({ where: { OR: [
      { paymentId: paymentId || '' }, { refundId: { in: [refundId || '', ...relatedRefundIds] } }, { chargeId: chargeId || '' }] } });
    const organizations = [...new Set([...(topup ? [topup.organizationId] : []), ...bindings.map(r => r.organizationId)])].sort();
    if (!topup && bindings.length) topup = await tx.aiWalletTopup.findUnique({ where: { id: bindings[0].topupId } });
    return { topup, organizations };
  }
  private async debitRefund(tx: Prisma.TransactionClient, reviewed: AiWalletRefundReconciliation) {
    const nanos = BigInt(reviewed.amountCents) * 10000000n;
    await tx.aiWallet.update({ where: { organizationId: reviewed.organizationId }, data: {
      balanceNanos: { decrement: nanos }, heldNanos: { decrement: nanos } } });
    await tx.aiWalletLedger.create({ data: { organizationId: reviewed.organizationId, externalKey: `refund:${reviewed.refundId}`,
      kind: 'REVERSAL', amountNanos: nanos, refundRequestId: reviewed.requestId } });
    await tx.aiWalletRefundRequest.update({ where: { id: reviewed.requestId }, data: {
      status: 'REFUNDED', resolvedByUserId: reviewed.reviewedByUserId, resolvedAt: await this.terminalTime(tx, reviewed.requestId) } });
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
      include: { reconciliation: true }, where: { status: 'REQUESTED', ...(after ? { OR: [{ createdAt: { gt: after.createdAt } },
        { createdAt: after.createdAt, id: { gt: after.id } }] } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 101 }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const page = rows.slice(0, 100), last = page[page.length - 1];
    return { requests: page.map(r => ({ ...this.publicRequest(r), organizationId: r.organizationId, testReconciliation: r.reconciliation })),
      nextCursor: rows.length > 100 ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url') : null };
  }
}
