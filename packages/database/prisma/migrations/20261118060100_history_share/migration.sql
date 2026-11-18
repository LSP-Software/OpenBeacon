-- CreateEnum
CREATE TYPE "HistoryShare" AS ENUM ('LAST_LOCATION', 'HOURS_6', 'DAY_1', 'WEEK_1', 'MAXIMUM');

-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN     "historyShare" "HistoryShare";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "historyShare" "HistoryShare" NOT NULL DEFAULT 'MAXIMUM',
ADD COLUMN     "historyShareChangedAt" TIMESTAMP(3);
