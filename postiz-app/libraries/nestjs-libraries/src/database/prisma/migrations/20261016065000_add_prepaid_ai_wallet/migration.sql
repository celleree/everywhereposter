-- CreateEnum
CREATE TYPE "AiWalletStatus" AS ENUM ('ACTIVE', 'REVIEW');

-- CreateEnum
CREATE TYPE "AiWalletReservationState" AS ENUM ('RESERVED', 'DISPATCHED', 'UNKNOWN', 'SETTLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "AiWalletLedgerKind" AS ENUM ('FUNDING', 'USAGE');

-- CreateTable
CREATE TABLE "AiWallet" (
    "organizationId" TEXT NOT NULL,
    "balanceNanos" BIGINT NOT NULL DEFAULT 0,
    "heldNanos" BIGINT NOT NULL DEFAULT 0,
    "status" "AiWalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWallet_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "AiWalletReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ceilingNanos" BIGINT NOT NULL,
    "reportedNanos" BIGINT,
    "chargedNanos" BIGINT,
    "state" "AiWalletReservationState" NOT NULL DEFAULT 'RESERVED',
    "providerRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWalletReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWalletLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "kind" "AiWalletLedgerKind" NOT NULL,
    "amountNanos" BIGINT NOT NULL,
    "reservationId" TEXT,
    "topupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiWalletLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWalletTopup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "sessionId" TEXT,
    "paymentId" TEXT,
    "fundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiWalletTopup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWalletPaymentEvent" (
    "eventId" TEXT NOT NULL,
    "topupId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "credited" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiWalletPaymentEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "AiWalletReservation_organizationId_state_idx" ON "AiWalletReservation"("organizationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletReservation_organizationId_operationKey_key" ON "AiWalletReservation"("organizationId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletReservation_id_organizationId_key" ON "AiWalletReservation"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletReservation_provider_providerRequestId_key" ON "AiWalletReservation"("provider", "providerRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletLedger_externalKey_key" ON "AiWalletLedger"("externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletLedger_reservationId_key" ON "AiWalletLedger"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletLedger_topupId_key" ON "AiWalletLedger"("topupId");

-- CreateIndex
CREATE INDEX "AiWalletLedger_organizationId_createdAt_idx" ON "AiWalletLedger"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletLedger_reservationId_organizationId_key" ON "AiWalletLedger"("reservationId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletLedger_topupId_organizationId_key" ON "AiWalletLedger"("topupId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletTopup_sessionId_key" ON "AiWalletTopup"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletTopup_paymentId_key" ON "AiWalletTopup"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletTopup_organizationId_operationKey_key" ON "AiWalletTopup"("organizationId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiWalletTopup_id_organizationId_key" ON "AiWalletTopup"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "AiWallet" ADD CONSTRAINT "AiWallet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWalletReservation" ADD CONSTRAINT "AiWalletReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AiWallet"("organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWalletLedger" ADD CONSTRAINT "AiWalletLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AiWallet"("organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWalletLedger" ADD CONSTRAINT "AiWalletLedger_reservationId_organizationId_fkey" FOREIGN KEY ("reservationId", "organizationId") REFERENCES "AiWalletReservation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWalletLedger" ADD CONSTRAINT "AiWalletLedger_topupId_organizationId_fkey" FOREIGN KEY ("topupId", "organizationId") REFERENCES "AiWalletTopup"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWalletTopup" ADD CONSTRAINT "AiWalletTopup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AiWallet"("organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWalletPaymentEvent" ADD CONSTRAINT "AiWalletPaymentEvent_topupId_organizationId_fkey" FOREIGN KEY ("topupId", "organizationId") REFERENCES "AiWalletTopup"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Monetary invariants apply even if a future caller bypasses the service.
ALTER TABLE "AiWallet" ADD CONSTRAINT "AiWallet_nonnegative_available"
  CHECK ("balanceNanos" >= 0 AND "heldNanos" >= 0 AND "heldNanos" <= "balanceNanos");
ALTER TABLE "AiWalletReservation" ADD CONSTRAINT "AiWalletReservation_valid_amounts"
  CHECK ("ceilingNanos" > 0 AND ("reportedNanos" IS NULL OR "reportedNanos" >= 0)
    AND ("chargedNanos" IS NULL OR ("chargedNanos" >= 0 AND "chargedNanos" <= "ceilingNanos"))
    AND ("state" <> 'SETTLED' OR ("chargedNanos" IS NOT NULL AND "providerRequestId" IS NOT NULL)));
ALTER TABLE "AiWalletLedger" ADD CONSTRAINT "AiWalletLedger_valid_source"
  CHECK ("amountNanos" > 0 AND (
    ("kind" = 'FUNDING' AND "topupId" IS NOT NULL AND "reservationId" IS NULL) OR
    ("kind" = 'USAGE' AND "reservationId" IS NOT NULL AND "topupId" IS NULL)));
ALTER TABLE "AiWalletTopup" ADD CONSTRAINT "AiWalletTopup_valid_funding"
  CHECK ("amountCents" > 0 AND "currency" = 'usd'
    AND ("fundedAt" IS NULL OR ("sessionId" IS NOT NULL AND "paymentId" IS NOT NULL)));
