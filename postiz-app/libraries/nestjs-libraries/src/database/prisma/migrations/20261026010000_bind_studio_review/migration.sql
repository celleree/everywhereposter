-- Additive, unapplied app bridge. Preserve all earlier migrations.
ALTER TABLE "StudioEditJob"
 ADD COLUMN "worker" JSONB,
 ADD COLUMN "technicalReceipt" JSONB,
 ADD COLUMN "outputMediaId" TEXT,
 ADD COLUMN "reviewedByUserId" TEXT,
 ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "StudioEditJob" DROP CONSTRAINT "StudioEditJob_state_check";
ALTER TABLE "StudioEditJob" ADD CONSTRAINT "StudioEditJob_state_check"
 CHECK ("state" IN ('ADMITTED','RUNNING','OUTPUT_STORED_UNVERIFIED','TECHNICAL_READY','REVIEWED','CANCELLED'));
CREATE UNIQUE INDEX "StudioEditJob_outputMediaId_key" ON "StudioEditJob"("outputMediaId");
ALTER TABLE "StudioEditJob" ADD CONSTRAINT "StudioEditJob_outputMediaId_fkey"
 FOREIGN KEY ("outputMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
