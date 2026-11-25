CREATE TABLE "FacebookPublicationReceipt" (
    "postId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "providerResult" JSONB,

    CONSTRAINT "FacebookPublicationReceipt_pkey" PRIMARY KEY ("postId")
);

ALTER TABLE "FacebookPublicationReceipt"
ADD CONSTRAINT "FacebookPublicationReceipt_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
