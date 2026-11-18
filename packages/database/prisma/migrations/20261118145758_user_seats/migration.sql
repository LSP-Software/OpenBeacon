-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastGracePeriodStartedAt" TIMESTAMP(3),
ADD COLUMN     "paidPeriodEndsAt" TIMESTAMP(3),
ADD COLUMN     "seats" INTEGER NOT NULL DEFAULT 2;
