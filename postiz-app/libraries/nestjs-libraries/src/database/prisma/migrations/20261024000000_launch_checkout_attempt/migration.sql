CREATE TYPE "LaunchCheckoutState" AS ENUM (
  'PREPARED', 'DISPATCHED', 'OPEN', 'EXPIRING', 'SETTLEMENT_PENDING', 'REVIEW', 'CLOSED'
);

CREATE TABLE "LaunchCheckoutAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "customerId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL CHECK ("requestFingerprint" ~ '^[a-f0-9]{64}$'),
  "parameters" JSONB NOT NULL CHECK (jsonb_typeof("parameters") = 'object'),
  "sessionId" TEXT,
  "state" "LaunchCheckoutState" NOT NULL DEFAULT 'PREPARED',
  "firstDispatchedAt" TIMESTAMP(3),
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LaunchCheckoutAttempt_bound_state" CHECK (
    "state" IN ('PREPARED', 'DISPATCHED', 'REVIEW') OR "sessionId" IS NOT NULL
  )
);
CREATE UNIQUE INDEX "LaunchCheckoutAttempt_operationKey_key" ON "LaunchCheckoutAttempt"("operationKey");
CREATE UNIQUE INDEX "LaunchCheckoutAttempt_sessionId_key" ON "LaunchCheckoutAttempt"("sessionId");
CREATE INDEX "LaunchCheckoutAttempt_organizationId_state_idx" ON "LaunchCheckoutAttempt"("organizationId", "state");
CREATE UNIQUE INDEX "LaunchCheckoutAttempt_one_unresolved_per_org"
  ON "LaunchCheckoutAttempt"("organizationId") WHERE "state" <> 'CLOSED';

-- Attempts are recovery evidence, never wallet entries. Retain their immutable
-- request and original dispatch clock even when an HTTP response was lost.
CREATE FUNCTION protect_launch_checkout_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Launch checkout recovery history cannot be deleted';
  END IF;
  IF ROW(NEW."id", NEW."organizationId", NEW."customerId", NEW."operationKey",
         NEW."requestFingerprint", NEW."parameters", NEW."createdAt") IS DISTINCT FROM
     ROW(OLD."id", OLD."organizationId", OLD."customerId", OLD."operationKey",
         OLD."requestFingerprint", OLD."parameters", OLD."createdAt") OR
     (OLD."firstDispatchedAt" IS NOT NULL AND NEW."firstDispatchedAt" IS DISTINCT FROM OLD."firstDispatchedAt") OR
     (OLD."sessionId" IS NOT NULL AND NEW."sessionId" IS DISTINCT FROM OLD."sessionId") OR
     (OLD."state" = 'CLOSED' AND NEW."state" <> 'CLOSED') THEN
    RAISE EXCEPTION 'Launch checkout identity or terminal state is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "LaunchCheckoutAttempt_preserve_history"
  BEFORE UPDATE OR DELETE ON "LaunchCheckoutAttempt"
  FOR EACH ROW EXECUTE FUNCTION protect_launch_checkout_attempt();
