UPDATE "PendingUpload" SET "groupId" = '' WHERE "groupId" IS NULL;

ALTER TABLE "PendingUpload" DROP CONSTRAINT "PendingUpload_pkey",
ALTER COLUMN "groupId" SET NOT NULL,
ALTER COLUMN "groupId" SET DEFAULT '',
ADD CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("userId", "uploadType", "groupId");

