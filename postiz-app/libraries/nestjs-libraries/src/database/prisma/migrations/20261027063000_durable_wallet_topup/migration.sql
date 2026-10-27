-- Existing rows retain their historical identity and cannot be redispatched.
ALTER TABLE "AiWalletTopup"
  ADD COLUMN "checkoutState" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "stripeMode" TEXT,
  ADD COLUMN "stripeAccountId" TEXT,
  ADD COLUMN "requestFingerprint" TEXT,
  ADD COLUMN "requestSnapshot" JSONB,
  ADD COLUMN "firstDispatchedAt" TIMESTAMP(3);

ALTER TABLE "AiWalletTopup" ADD CONSTRAINT "AiWalletTopup_checkout_shape" CHECK (
  ("checkoutState" = 'LEGACY' AND "stripeMode" IS NULL AND "stripeAccountId" IS NULL
    AND "requestFingerprint" IS NULL AND "requestSnapshot" IS NULL AND "firstDispatchedAt" IS NULL)
  OR
  ("checkoutState" IN ('PREPARED','DISPATCHED','BOUND') AND "stripeMode" = 'test'
    AND "stripeAccountId" ~ '^acct_[a-zA-Z0-9]{1,100}$'
    AND "requestFingerprint" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("requestSnapshot") = 'object'
    AND "stripeMode" IS NOT NULL AND "stripeAccountId" IS NOT NULL
    AND "requestFingerprint" IS NOT NULL AND "requestSnapshot" IS NOT NULL
    AND (("checkoutState" = 'PREPARED' AND "firstDispatchedAt" IS NULL AND "sessionId" IS NULL)
      OR ("checkoutState" = 'DISPATCHED' AND "firstDispatchedAt" IS NOT NULL AND "sessionId" IS NULL)
      OR ("checkoutState" = 'BOUND' AND "firstDispatchedAt" IS NOT NULL AND "sessionId" IS NOT NULL)))
);

CREATE FUNCTION "protect_wallet_topup_checkout"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Wallet top-up checkout history cannot be deleted';
  END IF;
  IF ROW(NEW."id",NEW."organizationId",NEW."operationKey",NEW."customerId",NEW."amountCents",NEW."currency",
         NEW."stripeMode",NEW."stripeAccountId",NEW."requestFingerprint",NEW."requestSnapshot",NEW."createdAt")
    IS DISTINCT FROM
     ROW(OLD."id",OLD."organizationId",OLD."operationKey",OLD."customerId",OLD."amountCents",OLD."currency",
         OLD."stripeMode",OLD."stripeAccountId",OLD."requestFingerprint",OLD."requestSnapshot",OLD."createdAt")
    OR (OLD."firstDispatchedAt" IS NOT NULL AND NEW."firstDispatchedAt" IS DISTINCT FROM OLD."firstDispatchedAt")
    OR (OLD."sessionId" IS NOT NULL AND NEW."sessionId" IS DISTINCT FROM OLD."sessionId")
    OR (OLD."paymentId" IS NOT NULL AND NEW."paymentId" IS DISTINCT FROM OLD."paymentId")
    OR (OLD."fundedAt" IS NOT NULL AND NEW."fundedAt" IS DISTINCT FROM OLD."fundedAt")
    OR NOT ((OLD."checkoutState" = NEW."checkoutState")
      OR (OLD."checkoutState" = 'PREPARED' AND NEW."checkoutState" = 'DISPATCHED')
      OR (OLD."checkoutState" = 'DISPATCHED' AND NEW."checkoutState" = 'BOUND')) THEN
    RAISE EXCEPTION 'Immutable wallet top-up identity or lifecycle changed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AiWalletTopup_checkout_immutable" BEFORE UPDATE OR DELETE ON "AiWalletTopup"
  FOR EACH ROW EXECUTE FUNCTION "protect_wallet_topup_checkout"();
