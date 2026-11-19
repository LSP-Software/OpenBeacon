-- AlterEnum
ALTER TYPE "AccountNoticeType" ADD VALUE 'SEATS_ENDED';

-- AlterTable
ALTER TABLE "AccountNotice" ADD COLUMN     "emailedAt" TIMESTAMP(3);
