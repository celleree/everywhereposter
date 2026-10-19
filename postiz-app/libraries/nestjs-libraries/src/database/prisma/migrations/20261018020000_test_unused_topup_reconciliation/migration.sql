-- Branch-local test-mode support only; production application is a separate gate.
ALTER TYPE "AiWalletLedgerKind" ADD VALUE 'REVERSAL';
ALTER TYPE "AiWalletRefundRequestStatus" ADD VALUE 'REFUNDED';
ALTER TABLE "AiWalletRefundRequest" ADD CONSTRAINT "AiWalletRefundRequest_id_organizationId_key" UNIQUE ("id", "organizationId");
ALTER TABLE "AiWalletRefundRequest" DROP CONSTRAINT "AiWalletRefundRequest_resolution";
ALTER TABLE "AiWalletRefundRequest" ADD CONSTRAINT "AiWalletRefundRequest_resolution" CHECK (
  ("status"::text = 'REQUESTED' AND "resolvedByUserId" IS NULL AND "resolvedAt" IS NULL) OR
  ("status"::text IN ('WITHDRAWN', 'REJECTED', 'REFUNDED') AND "resolvedByUserId" IS NOT NULL
    AND length("resolvedByUserId") > 0 AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= "createdAt"));
ALTER TABLE "AiWalletLedger" ADD COLUMN "refundRequestId" TEXT UNIQUE,
  ADD CONSTRAINT "AiWalletLedger_refundRequestId_organizationId_fkey" FOREIGN KEY ("refundRequestId", "organizationId")
    REFERENCES "AiWalletRefundRequest"("id", "organizationId");
ALTER TABLE "AiWalletLedger" DROP CONSTRAINT "AiWalletLedger_valid_source";
ALTER TABLE "AiWalletLedger" ADD CONSTRAINT "AiWalletLedger_valid_source" CHECK ("amountNanos" > 0 AND (
  ("kind"::text = 'FUNDING' AND "topupId" IS NOT NULL AND "reservationId" IS NULL AND "refundRequestId" IS NULL) OR
  ("kind"::text = 'USAGE' AND "reservationId" IS NOT NULL AND "topupId" IS NULL AND "refundRequestId" IS NULL) OR
  ("kind"::text = 'REVERSAL' AND "refundRequestId" IS NOT NULL AND "topupId" IS NULL AND "reservationId" IS NULL)));
CREATE TABLE "AiWalletRefundReconciliation" (
  "requestId" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "topupId" TEXT NOT NULL UNIQUE,
  "paymentId" TEXT NOT NULL UNIQUE,
  "chargeId" TEXT NOT NULL UNIQUE,
  "refundId" TEXT NOT NULL UNIQUE,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
  "currency" TEXT NOT NULL CHECK ("currency" = 'usd'),
  "reviewedByUserId" TEXT NOT NULL CHECK (length("reviewedByUserId") > 0),
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "state" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("state" IN ('PENDING', 'FAILED', 'UNCERTAIN', 'SUCCEEDED')),
  FOREIGN KEY ("requestId", "organizationId") REFERENCES "AiWalletRefundRequest"("id", "organizationId"),
  FOREIGN KEY ("topupId", "organizationId") REFERENCES "AiWalletTopup"("id", "organizationId")
);
CREATE TABLE "AiWalletRefundEvent" (
  "eventId" TEXT PRIMARY KEY,
  "organizationId" TEXT REFERENCES "AiWallet"("organizationId"),
  "paymentId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "outcome" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AiWalletRefundEvent_organizationId_createdAt_idx" ON "AiWalletRefundEvent"("organizationId", "createdAt");
CREATE FUNCTION protect_test_refund_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Test refund history cannot be deleted'; END IF;
  IF TG_TABLE_NAME = 'AiWalletRefundEvent' THEN RAISE EXCEPTION 'Test refund events are immutable'; END IF;
  IF (to_jsonb(NEW) - 'state') IS DISTINCT FROM (to_jsonb(OLD) - 'state') THEN
    RAISE EXCEPTION 'Test refund review identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AiWalletRefundReconciliation_history" BEFORE UPDATE OR DELETE ON "AiWalletRefundReconciliation"
  FOR EACH ROW EXECUTE FUNCTION protect_test_refund_history();
CREATE TRIGGER "AiWalletRefundEvent_history" BEFORE UPDATE OR DELETE ON "AiWalletRefundEvent"
  FOR EACH ROW EXECUTE FUNCTION protect_test_refund_history();

CREATE UNIQUE INDEX "AiWalletLedger_refundRequestId_organizationId_key" ON "AiWalletLedger"("refundRequestId", "organizationId");
CREATE UNIQUE INDEX "AiWalletRefundReconciliation_requestId_organizationId_key" ON "AiWalletRefundReconciliation"("requestId", "organizationId");
CREATE UNIQUE INDEX "AiWalletRefundReconciliation_topupId_organizationId_key" ON "AiWalletRefundReconciliation"("topupId", "organizationId");
CREATE INDEX "AiWalletRefundEvent_paymentId_idx" ON "AiWalletRefundEvent"("paymentId");
