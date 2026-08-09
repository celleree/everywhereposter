CREATE TYPE "MediaTranscriptionStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED'
);

CREATE TABLE "MediaTranscription" (
  "id" TEXT NOT NULL,
  "mediaId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "status" "MediaTranscriptionStatus" NOT NULL DEFAULT 'PENDING',
  "text" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MediaTranscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaTranscription_mediaId_key"
  ON "MediaTranscription"("mediaId");

CREATE INDEX "MediaTranscription_status_requestedAt_idx"
  ON "MediaTranscription"("status", "requestedAt");

ALTER TABLE "MediaTranscription"
  ADD CONSTRAINT "MediaTranscription_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "Media"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
