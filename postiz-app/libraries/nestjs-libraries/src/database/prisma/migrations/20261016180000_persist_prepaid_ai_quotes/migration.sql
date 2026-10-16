ALTER TABLE "AiWalletReservation"
  ADD COLUMN "quoteSnapshot" JSONB,
  ADD COLUMN "quoteFingerprint" TEXT,
  ADD COLUMN "usageSnapshot" JSONB,
  ADD COLUMN "usageFingerprint" TEXT,
  ADD CONSTRAINT "AiWalletReservation_quote_pair" CHECK (("quoteSnapshot" IS NULL) = ("quoteFingerprint" IS NULL)),
  ADD CONSTRAINT "AiWalletReservation_usage_pair" CHECK (("usageSnapshot" IS NULL) = ("usageFingerprint" IS NULL));
