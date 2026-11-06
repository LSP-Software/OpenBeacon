ALTER TABLE "AccountDeletionCleanup" ADD COLUMN "imageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
