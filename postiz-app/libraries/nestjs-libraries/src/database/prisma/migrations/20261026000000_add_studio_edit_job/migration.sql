CREATE TABLE "StudioEditJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceMediaId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ADMITTED',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "leaseToken" TEXT,
    "artifactSha256" TEXT,
    "artifactBytes" INTEGER,
    "artifactKey" TEXT,
    "storagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioEditJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudioEditJob_state_check" CHECK ("state" IN ('ADMITTED','RUNNING','OUTPUT_STORED_UNVERIFIED','CANCELLED')),
    CONSTRAINT "StudioEditJob_generation_check" CHECK ("generation" BETWEEN 1 AND 10000)
);
CREATE UNIQUE INDEX "StudioEditJob_organizationId_requestKey_key" ON "StudioEditJob"("organizationId", "requestKey");
CREATE UNIQUE INDEX "StudioEditJob_artifactKey_key" ON "StudioEditJob"("artifactKey");
CREATE INDEX "StudioEditJob_organizationId_state_createdAt_idx" ON "StudioEditJob"("organizationId", "state", "createdAt");
ALTER TABLE "StudioEditJob" ADD CONSTRAINT "StudioEditJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioEditJob" ADD CONSTRAINT "StudioEditJob_sourceMediaId_fkey" FOREIGN KEY ("sourceMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
