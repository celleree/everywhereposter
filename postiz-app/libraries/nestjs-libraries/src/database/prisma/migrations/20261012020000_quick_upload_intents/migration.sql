-- CreateTable
CREATE TABLE "QuickUploadIntent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "consentVersion" TEXT NOT NULL DEFAULT 'quick-upload-v1',
    "destinations" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "dispatched" BOOLEAN NOT NULL DEFAULT false,
    "copyStartedAt" TIMESTAMP(3),
    "generated" JSONB,
    "submissionBody" JSONB,
    "results" JSONB NOT NULL DEFAULT '[]',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickUploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickUploadIntent_sessionId_key" ON "QuickUploadIntent"("sessionId");

-- CreateIndex
CREATE INDEX "QuickUploadIntent_dispatched_createdAt_idx" ON "QuickUploadIntent"("dispatched", "createdAt");

-- AddForeignKey
ALTER TABLE "QuickUploadIntent" ADD CONSTRAINT "QuickUploadIntent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VideoUploadSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickUploadIntent" ADD CONSTRAINT "QuickUploadIntent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "QuickUploadIntent" ADD CONSTRAINT "QuickUploadIntent_status_check" CHECK ("status" IN ('WAITING','PROCESSING','GENERATING','GENERATED','PUBLISHING','COMPLETE','FAILED','CANCELLED'));
ALTER TABLE "QuickUploadIntent" ADD CONSTRAINT "QuickUploadIntent_destination_check" CHECK (jsonb_typeof("destinations") = 'array' AND jsonb_array_length("destinations") BETWEEN 1 AND 100);
ALTER TABLE "QuickUploadIntent" ADD CONSTRAINT "QuickUploadIntent_results_check" CHECK (jsonb_typeof("results") = 'array');
ALTER TABLE "QuickUploadIntent" ADD CONSTRAINT "QuickUploadIntent_copy_check" CHECK ("status" NOT IN ('GENERATING','GENERATED','PUBLISHING') OR "copyStartedAt" IS NOT NULL);
ALTER TABLE "QuickUploadIntent" ADD CONSTRAINT "QuickUploadIntent_generated_check" CHECK ("status" NOT IN ('GENERATED','PUBLISHING') OR "generated" IS NOT NULL);
ALTER TABLE "QuickUploadIntent" ADD CONSTRAINT "QuickUploadIntent_submission_check" CHECK ("status" != 'PUBLISHING' OR "submissionBody" IS NOT NULL);
