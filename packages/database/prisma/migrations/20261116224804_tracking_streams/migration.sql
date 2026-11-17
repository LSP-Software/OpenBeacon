/*
  Warnings:

  - You are about to drop the `GroupEncryptedPayload` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "GroupEncryptedPayload" DROP CONSTRAINT "GroupEncryptedPayload_epochId_fkey";

-- DropForeignKey
ALTER TABLE "GroupEncryptedPayload" DROP CONSTRAINT "GroupEncryptedPayload_groupId_fkey";

-- DropForeignKey
ALTER TABLE "GroupEncryptedPayload" DROP CONSTRAINT "GroupEncryptedPayload_senderDeviceId_fkey";

-- DropForeignKey
ALTER TABLE "GroupEncryptedPayload" DROP CONSTRAINT "GroupEncryptedPayload_senderUserId_fkey";

-- DropTable
DROP TABLE "GroupEncryptedPayload";

-- CreateTable
CREATE TABLE "TrackingStream" (
    "id" BIGSERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "epochId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "revisionPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingStream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingPoint" (
    "streamId" BIGINT NOT NULL,
    "pointId" BIGINT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" BYTEA NOT NULL,

    CONSTRAINT "TrackingPoint_pkey" PRIMARY KEY ("streamId","pointId")
);

-- CreateTable
CREATE TABLE "TrackingLatestPoint" (
    "groupId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "streamId" BIGINT NOT NULL,
    "payload" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingLatestPoint_pkey" PRIMARY KEY ("groupId","senderDeviceId")
);

-- CreateIndex
CREATE INDEX "TrackingStream_senderUserId_groupId_idx" ON "TrackingStream"("senderUserId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingStream_groupId_epochId_senderDeviceId_revisionPrefi_key" ON "TrackingStream"("groupId", "epochId", "senderDeviceId", "revisionPrefix");

-- CreateIndex
CREATE INDEX "TrackingPoint_streamId_receivedAt_idx" ON "TrackingPoint"("streamId", "receivedAt");

-- CreateIndex
CREATE INDEX "TrackingLatestPoint_streamId_idx" ON "TrackingLatestPoint"("streamId");

-- CreateIndex
CREATE INDEX "TrackingLatestPoint_senderDeviceId_idx" ON "TrackingLatestPoint"("senderDeviceId");

-- AddForeignKey
ALTER TABLE "TrackingStream" ADD CONSTRAINT "TrackingStream_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingStream" ADD CONSTRAINT "TrackingStream_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "GroupEpoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingStream" ADD CONSTRAINT "TrackingStream_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "UserDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingStream" ADD CONSTRAINT "TrackingStream_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "TrackingStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLatestPoint" ADD CONSTRAINT "TrackingLatestPoint_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLatestPoint" ADD CONSTRAINT "TrackingLatestPoint_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLatestPoint" ADD CONSTRAINT "TrackingLatestPoint_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "TrackingStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrackingPoint" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 1000);
