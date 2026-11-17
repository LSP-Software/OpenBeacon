-- AlterEnum
ALTER TYPE "AccountNoticeType" ADD VALUE 'ALERTS_TURNED_OFF';

-- AlterTable
ALTER TABLE "AccountNotice" ADD COLUMN     "turnedOffEmail" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[],
ADD COLUMN     "turnedOffPhone" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[];
