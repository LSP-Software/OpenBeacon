-- AlterTable
ALTER TABLE "User" ADD COLUMN     "paidPeriodEndsAt" TIMESTAMP(3),
ADD COLUMN     "seats" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "seatsEndedNoticeFor" TIMESTAMP(3);
