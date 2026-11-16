-- AlterTable
ALTER TABLE "PendingUpload" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "fileSize" INTEGER;
