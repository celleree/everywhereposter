CREATE TYPE "AiWalletRefundRequestStatus" AS ENUM ('REQUESTED', 'WITHDRAWN', 'REJECTED');
ALTER TABLE "AiWalletRefundRequest"
  ADD COLUMN "status" "AiWalletRefundRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  ADD COLUMN "resolvedByUserId" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD CONSTRAINT "AiWalletRefundRequest_resolution" CHECK (
    ("status" = 'REQUESTED' AND "resolvedByUserId" IS NULL AND "resolvedAt" IS NULL) OR
    ("status" IN ('WITHDRAWN', 'REJECTED') AND length("resolvedByUserId") > 0
      AND "resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= "createdAt")
  );
CREATE INDEX "AiWalletRefundRequest_status_createdAt_id_idx" ON "AiWalletRefundRequest"("status", "createdAt", "id");

-- Preserve creation identity/amount and terminal history even for accidental
-- internal writes. There is no approval, payment or financial reversal state.
CREATE FUNCTION protect_unused_credit_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Refund request history cannot be deleted'; END IF;
  IF OLD."status" <> 'REQUESTED' OR NEW."status" = 'REQUESTED' OR
    ROW(NEW."id", NEW."organizationId", NEW."operationKey", NEW."requestedByUserId", NEW."requestedNanos", NEW."createdAt") IS DISTINCT FROM
    ROW(OLD."id", OLD."organizationId", OLD."operationKey", OLD."requestedByUserId", OLD."requestedNanos", OLD."createdAt") THEN
    RAISE EXCEPTION 'Refund request history is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AiWalletRefundRequest_history" BEFORE UPDATE OR DELETE ON "AiWalletRefundRequest"
  FOR EACH ROW EXECUTE FUNCTION protect_unused_credit_request();
