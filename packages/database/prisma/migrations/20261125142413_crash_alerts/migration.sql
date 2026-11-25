-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CRASH_ALERTS';

-- CreateTable
CREATE TABLE "CrashAlert" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "epochId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "payload" BYTEA NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrashAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrashAlert_groupId_receivedAt_idx" ON "CrashAlert"("groupId", "receivedAt");

-- CreateIndex
CREATE INDEX "CrashAlert_receivedAt_idx" ON "CrashAlert"("receivedAt");

-- CreateIndex
CREATE INDEX "CrashAlert_senderDeviceId_idx" ON "CrashAlert"("senderDeviceId");

-- CreateIndex
CREATE INDEX "CrashAlert_senderUserId_idx" ON "CrashAlert"("senderUserId");

-- CreateIndex
CREATE INDEX "CrashAlert_epochId_idx" ON "CrashAlert"("epochId");

-- CreateIndex
CREATE UNIQUE INDEX "CrashAlert_groupId_messageId_key" ON "CrashAlert"("groupId", "messageId");

-- AddForeignKey
ALTER TABLE "CrashAlert" ADD CONSTRAINT "CrashAlert_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashAlert" ADD CONSTRAINT "CrashAlert_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "GroupEpoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashAlert" ADD CONSTRAINT "CrashAlert_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashAlert" ADD CONSTRAINT "CrashAlert_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
