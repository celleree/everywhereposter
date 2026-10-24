-- Additive: existing access tokens remain valid but require a new consent/code
-- exchange to obtain a refresh family. Review before production application.
ALTER TABLE "OAuthAuthorization" ADD COLUMN "refreshFamilyId" TEXT;

CREATE TABLE "OAuthRefreshToken" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY,
  "authorizationId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "OAuthRefreshToken_authorizationId_fkey" FOREIGN KEY ("authorizationId")
    REFERENCES "OAuthAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OAuthRefreshToken_authorizationId_familyId_idx" ON "OAuthRefreshToken"("authorizationId", "familyId");
CREATE INDEX "OAuthRefreshToken_expiresAt_idx" ON "OAuthRefreshToken"("expiresAt");
