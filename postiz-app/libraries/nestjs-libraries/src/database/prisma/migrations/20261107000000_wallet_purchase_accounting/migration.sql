-- Dormant accounting only: no backfill, runtime enrollment, capacity sums or FIFO execution.
CREATE TABLE "AiWalletPurchaseCohort" (
  "organizationId" TEXT PRIMARY KEY REFERENCES "AiWallet"("organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "stripeAccountId" TEXT NOT NULL CHECK ("stripeAccountId" ~ '^acct_[a-zA-Z0-9]{1,100}$'),
  "stripeMode" TEXT NOT NULL CHECK ("stripeMode" IN ('test', 'live')),
  "accountingVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("accountingVersion" = 1),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION protect_wallet_purchase_cohort() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Purchase cohort history is immutable'; END IF;
  -- A row lock cannot refresh a REPEATABLE READ/SERIALIZABLE transaction snapshot.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Purchase cohort enrollment requires READ COMMITTED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."organizationId", 3));
  PERFORM 1 FROM "AiWallet" WHERE "organizationId" = NEW."organizationId" FOR UPDATE;
  -- Separate statements after both locks observe writers that committed while we waited.
  IF NOT EXISTS (SELECT 1 FROM "AiWallet" WHERE "organizationId" = NEW."organizationId"
      AND "status" = 'ACTIVE' AND "balanceNanos" = 0 AND "heldNanos" = 0)
    OR EXISTS (SELECT 1 FROM "AiWalletTopup" WHERE "organizationId" = NEW."organizationId")
    OR EXISTS (SELECT 1 FROM "AiWalletLedger" WHERE "organizationId" = NEW."organizationId")
    OR EXISTS (SELECT 1 FROM "AiWalletReservation" WHERE "organizationId" = NEW."organizationId")
    OR EXISTS (SELECT 1 FROM "AiWalletRefundRequest" WHERE "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Purchase cohort requires a pristine active wallet';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AiWalletPurchaseCohort_history" BEFORE INSERT OR UPDATE OR DELETE ON "AiWalletPurchaseCohort"
  FOR EACH ROW EXECUTE FUNCTION protect_wallet_purchase_cohort();

CREATE TABLE "AiWalletPurchaseAllocation" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "AiWalletPurchaseCohort"("organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "topupId" TEXT NOT NULL,
  "reservationId" TEXT,
  "refundRequestId" TEXT,
  "allocatedNanos" BIGINT NOT NULL,
  "consumedNanos" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  FOREIGN KEY ("topupId", "organizationId") REFERENCES "AiWalletTopup"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("reservationId", "organizationId") REFERENCES "AiWalletReservation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("refundRequestId", "organizationId") REFERENCES "AiWalletRefundRequest"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AiWalletPurchaseAllocation_shape" CHECK (
    ("reservationId" IS NOT NULL) <> ("refundRequestId" IS NOT NULL)
    AND "allocatedNanos" > 0
    AND (("consumedNanos" IS NULL AND "closedAt" IS NULL)
      OR ("consumedNanos" IS NOT NULL AND "closedAt" IS NOT NULL
        AND "consumedNanos" >= 0 AND "consumedNanos" <= "allocatedNanos" AND "closedAt" >= "createdAt"))
  )
);
CREATE UNIQUE INDEX "AiWalletPurchaseAllocation_reservationId_topupId_key" ON "AiWalletPurchaseAllocation"("reservationId", "topupId");
CREATE UNIQUE INDEX "AiWalletPurchaseAllocation_refundRequestId_topupId_key" ON "AiWalletPurchaseAllocation"("refundRequestId", "topupId");
CREATE INDEX "AiWalletPurchaseAllocation_topupId_organizationId_idx" ON "AiWalletPurchaseAllocation"("topupId", "organizationId");
CREATE INDEX "AiWalletPurchaseAllocation_organizationId_createdAt_id_idx" ON "AiWalletPurchaseAllocation"("organizationId", "createdAt", "id");

CREATE FUNCTION protect_wallet_purchase_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Purchase allocation history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."consumedNanos" IS NOT NULL OR NEW."closedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Purchase allocation must be inserted open';
    END IF;
    -- NOT EXISTS rejects missing/NULL provenance instead of accepting SQL UNKNOWN.
    IF NOT EXISTS (SELECT 1 FROM "AiWalletTopup" t JOIN "AiWalletPurchaseCohort" c
        ON c."organizationId" = t."organizationId"
        WHERE t."id" = NEW."topupId" AND t."organizationId" = NEW."organizationId"
          AND t."stripeAccountId" = c."stripeAccountId" AND t."stripeMode" = c."stripeMode"
          AND t."fundedAt" IS NOT NULL AND t."checkoutState" = 'BOUND') THEN
      RAISE EXCEPTION 'Purchase allocation requires matching funded bound provenance';
    END IF;
  ELSIF OLD."closedAt" IS NOT NULL OR NEW."closedAt" IS NULL OR NEW."consumedNanos" IS NULL
    OR ROW(NEW."id", NEW."organizationId", NEW."topupId", NEW."reservationId", NEW."refundRequestId", NEW."allocatedNanos", NEW."createdAt")
      IS DISTINCT FROM
       ROW(OLD."id", OLD."organizationId", OLD."topupId", OLD."reservationId", OLD."refundRequestId", OLD."allocatedNanos", OLD."createdAt") THEN
    RAISE EXCEPTION 'Purchase allocation permits only one immutable closure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AiWalletPurchaseAllocation_history" BEFORE INSERT OR UPDATE OR DELETE ON "AiWalletPurchaseAllocation"
  FOR EACH ROW EXECUTE FUNCTION protect_wallet_purchase_allocation();
