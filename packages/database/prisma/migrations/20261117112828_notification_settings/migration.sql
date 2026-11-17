-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PLACE_ALERTS', 'MEMBER_JOINED', 'MEMBER_LEFT', 'ROLE_CHANGED', 'NEW_SIGN_IN', 'PASSWORD_CHANGED', 'RECOVERY_PHRASE_CHANGED', 'OTHER_SESSIONS_SIGNED_OUT', 'DEVICE_REMOVED', 'DELETION_SCHEDULED');

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "email" BOOLEAN NOT NULL,
    "phone" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("userId","type")
);

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy existing email opt-outs
INSERT INTO "NotificationSetting" ("userId", "type", "email", "phone", "updatedAt")
SELECT "id", 'NEW_SIGN_IN', false, true, CURRENT_TIMESTAMP FROM "User" WHERE "alertNewSignIn" = false;

INSERT INTO "NotificationSetting" ("userId", "type", "email", "phone", "updatedAt")
SELECT "id", 'DELETION_SCHEDULED', false, true, CURRENT_TIMESTAMP FROM "User" WHERE "alertDeletionScheduled" = false;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "alertDeletionScheduled",
DROP COLUMN "alertNewSignIn";
