-- Legacy grants remain stored but require reauthorization with security metadata.
ALTER TABLE "OAuthAuthorization"
  ADD COLUMN "scope" TEXT,
  ADD COLUMN "resource" TEXT,
  ADD COLUMN "redirectUri" TEXT,
  ADD COLUMN "codeChallenge" TEXT,
  ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
