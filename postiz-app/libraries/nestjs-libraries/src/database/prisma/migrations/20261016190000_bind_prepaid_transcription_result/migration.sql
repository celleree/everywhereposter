ALTER TABLE "AiWalletReservation" ADD COLUMN "resultFingerprint" TEXT;
ALTER TABLE "AiWalletReservation" ADD CONSTRAINT "AiWalletReservation_result_fingerprint"
  CHECK ("resultFingerprint" IS NULL OR "resultFingerprint" ~ '^[a-f0-9]{64}$');
