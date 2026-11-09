-- AlterTable
ALTER TABLE "User" ADD COLUMN     "alertDeletionScheduled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alertNewDevice" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "UserDevice" ADD COLUMN     "model" TEXT,
ADD COLUMN     "platform" TEXT;

