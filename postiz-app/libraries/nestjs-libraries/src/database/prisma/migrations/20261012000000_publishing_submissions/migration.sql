CREATE TABLE "PublishingSubmission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublishingSubmission_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PublishingSubmission_organizationId_attemptId_key"
  ON "PublishingSubmission"("organizationId", "attemptId");
CREATE TABLE "PublishingSubmissionDestination" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "submissionId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1 CHECK ("generation" > 0),
  "dispatched" BOOLEAN NOT NULL DEFAULT false,
  "providerState" TEXT NOT NULL DEFAULT 'READY'
    CHECK ("providerState" IN ('READY', 'IN_FLIGHT', 'SUCCEEDED', 'UNCERTAIN')),
  "providerResult" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublishingSubmissionDestination_submissionId_fkey" FOREIGN KEY ("submissionId")
    REFERENCES "PublishingSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublishingSubmissionDestination_postId_fkey" FOREIGN KEY ("postId")
    REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PublishingSubmissionDestination_postId_key"
  ON "PublishingSubmissionDestination"("postId");
CREATE UNIQUE INDEX "PublishingSubmissionDestination_submissionId_integrationId_key"
  ON "PublishingSubmissionDestination"("submissionId", "integrationId");
CREATE INDEX "PublishingSubmissionDestination_dispatched_createdAt_idx"
  ON "PublishingSubmissionDestination"("dispatched", "createdAt");
