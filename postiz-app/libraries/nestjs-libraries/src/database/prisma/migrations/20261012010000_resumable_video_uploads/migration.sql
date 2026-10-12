-- CreateTable
CREATE TABLE "VideoUploadSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "manifest" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "mediaId" TEXT,
    "stagingCleaned" BOOLEAN NOT NULL DEFAULT false,
    "duration" DOUBLE PRECISION,
    "mimeType" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoUploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoUploadPart" (
    "sessionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "token" TEXT NOT NULL,

    CONSTRAINT "VideoUploadPart_pkey" PRIMARY KEY ("sessionId","index")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoUploadSession_mediaId_key" ON "VideoUploadSession"("mediaId");

-- CreateIndex
CREATE INDEX "VideoUploadSession_status_expiresAt_idx" ON "VideoUploadSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoUploadSession_organizationId_clientId_key" ON "VideoUploadSession"("organizationId", "clientId");

-- AddForeignKey
ALTER TABLE "VideoUploadSession" ADD CONSTRAINT "VideoUploadSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoUploadSession" ADD CONSTRAINT "VideoUploadSession_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoUploadPart" ADD CONSTRAINT "VideoUploadPart_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VideoUploadSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep identities and allocation invariants enforceable outside the HTTP DTO.
ALTER TABLE "VideoUploadSession" ADD CONSTRAINT "VideoUploadSession_allocation_check" CHECK (
  "byteSize" BETWEEN 1 AND 1048576000 AND "generation" >= 0 AND
  "manifest" IS NOT NULL AND array_position("manifest", NULL) IS NULL AND
  cardinality("manifest") = (("byteSize" + 8388607) / 8388608) AND
  "status" IN ('UPLOADING','FINALIZING','COMPLETE','FAILED','CANCELLED','EXPIRED') AND
  (("leaseToken" IS NULL) = ("leaseUntil" IS NULL)) AND
  ("status" <> 'COMPLETE' OR ("mediaId" IS NOT NULL AND "duration" IS NOT NULL AND "mediaId" = "id" AND "duration" > 0 AND "duration" <= 600))
);
ALTER TABLE "VideoUploadPart" ADD CONSTRAINT "VideoUploadPart_allocation_check" CHECK (
  "index" >= 0 AND "byteSize" BETWEEN 1 AND 8388608 AND "digest" ~ '^[a-f0-9]{64}$'
);
