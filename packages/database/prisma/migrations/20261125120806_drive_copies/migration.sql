-- CreateTable
CREATE TABLE "DriveCopy" (
    "groupId" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "epochId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "startHour" INTEGER NOT NULL,
    "payload" BYTEA NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "DriveCopy_pkey" PRIMARY KEY ("groupId","driveId")
);

-- CreateIndex
CREATE INDEX "DriveCopy_groupId_startHour_idx" ON "DriveCopy"("groupId", "startHour");

-- CreateIndex
CREATE INDEX "DriveCopy_senderUserId_driveId_idx" ON "DriveCopy"("senderUserId", "driveId");

-- CreateIndex
CREATE INDEX "DriveCopy_senderDeviceId_idx" ON "DriveCopy"("senderDeviceId");

-- CreateIndex
CREATE INDEX "DriveCopy_epochId_idx" ON "DriveCopy"("epochId");

-- AddForeignKey
ALTER TABLE "DriveCopy" ADD CONSTRAINT "DriveCopy_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveCopy" ADD CONSTRAINT "DriveCopy_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "GroupEpoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveCopy" ADD CONSTRAINT "DriveCopy_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveCopy" ADD CONSTRAINT "DriveCopy_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
