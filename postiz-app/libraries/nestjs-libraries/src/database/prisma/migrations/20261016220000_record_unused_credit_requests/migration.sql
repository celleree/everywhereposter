CREATE TABLE "AiWalletRefundRequest" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "AiWallet"("organizationId"),
  "operationKey" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "requestedNanos" BIGINT NOT NULL CHECK ("requestedNanos" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AiWalletRefundRequest_organizationId_operationKey_key" ON "AiWalletRefundRequest"("organizationId", "operationKey");
CREATE INDEX "AiWalletRefundRequest_organizationId_createdAt_idx" ON "AiWalletRefundRequest"("organizationId", "createdAt");
