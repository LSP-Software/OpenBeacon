-- CreateEnum
CREATE TYPE "AccountNoticeType" AS ENUM ('NEW_SIGN_IN', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'RECOVERY_PHRASE_CHANGED', 'RECOVERY_PHRASE_RESET', 'OTHER_SESSIONS_SIGNED_OUT', 'DEVICE_REMOVED', 'DELETION_SCHEDULED');

-- CreateTable
CREATE TABLE "AccountNotice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AccountNoticeType" NOT NULL,
    "excludeDeviceId" TEXT,
    "deviceName" TEXT,
    "deviceModel" TEXT,
    "devicePlatform" TEXT,
    "deletionDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountNotice_userId_createdAt_id_idx" ON "AccountNotice"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AccountNotice_createdAt_idx" ON "AccountNotice"("createdAt");

-- AddForeignKey
ALTER TABLE "AccountNotice" ADD CONSTRAINT "AccountNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
