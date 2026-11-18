-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountNoticeType" ADD VALUE 'SEATS_ENDING';
ALTER TYPE "AccountNoticeType" ADD VALUE 'SEATS_ENDING_SOON';
ALTER TYPE "AccountNoticeType" ADD VALUE 'SEAT_HOLD_COMING';

-- AlterTable
ALTER TABLE "AccountNotice" ADD COLUMN     "holdsFrom" TIMESTAMP(3);
