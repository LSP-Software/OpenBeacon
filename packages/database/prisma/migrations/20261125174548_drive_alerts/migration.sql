-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DRIVES';

-- CreateTable
CREATE TABLE "DriveAlertMute" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "muterUserId" TEXT NOT NULL,
    "mutedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveAlertMute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriveAlertMute_muterUserId_groupId_idx" ON "DriveAlertMute"("muterUserId", "groupId");

-- CreateIndex
CREATE INDEX "DriveAlertMute_mutedUserId_groupId_idx" ON "DriveAlertMute"("mutedUserId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveAlertMute_person_key" ON "DriveAlertMute"("groupId", "muterUserId", "mutedUserId") WHERE ("mutedUserId" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "DriveAlertMute_everyone_key" ON "DriveAlertMute"("groupId", "muterUserId") WHERE ("mutedUserId" IS NULL);

-- AddForeignKey
ALTER TABLE "DriveAlertMute" ADD CONSTRAINT "DriveAlertMute_muterUserId_groupId_fkey" FOREIGN KEY ("muterUserId", "groupId") REFERENCES "GroupMember"("userId", "groupId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveAlertMute" ADD CONSTRAINT "DriveAlertMute_mutedUserId_groupId_fkey" FOREIGN KEY ("mutedUserId", "groupId") REFERENCES "GroupMember"("userId", "groupId") ON DELETE CASCADE ON UPDATE CASCADE;
