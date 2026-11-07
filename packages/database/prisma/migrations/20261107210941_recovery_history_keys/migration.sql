-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN     "joinedEpochNumber" INTEGER;

UPDATE "GroupMember" AS member
SET "joinedEpochNumber" = COALESCE(
  (
    SELECT MIN(epoch."epochNumber")
    FROM "GroupEpoch" AS epoch
    JOIN "GroupEpochRecipientKey" AS recipient ON recipient."groupEpochId" = epoch.id
    JOIN "UserDevice" AS device ON device.id = recipient."recipientDeviceId"
    WHERE epoch."groupId" = member."groupId" AND device."userId" = member."userId"
  ),
  (SELECT MAX(epoch."epochNumber") FROM "GroupEpoch" AS epoch WHERE epoch."groupId" = member."groupId"),
  1
);

ALTER TABLE "GroupMember" ALTER COLUMN "joinedEpochNumber" SET NOT NULL;

-- CreateTable
CREATE TABLE "RecoveryKey" (
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "derivationVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryKey_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AccountHistoryKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "escrowEnc" TEXT NOT NULL,
    "escrowCiphertext" TEXT NOT NULL,
    "escrowAlgorithm" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountHistoryKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupEpochHistoryWrap" (
    "id" TEXT NOT NULL,
    "groupEpochId" TEXT NOT NULL,
    "historyKeyId" TEXT NOT NULL,
    "senderDeviceId" TEXT,
    "senderPublicKey" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "ephemeralPublicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupEpochHistoryWrap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountHistoryKey_userId_version_key" ON "AccountHistoryKey"("userId", "version");

-- CreateIndex
CREATE INDEX "GroupEpochHistoryWrap_historyKeyId_idx" ON "GroupEpochHistoryWrap"("historyKeyId");

-- CreateIndex
CREATE INDEX "GroupEpochHistoryWrap_senderDeviceId_idx" ON "GroupEpochHistoryWrap"("senderDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupEpochHistoryWrap_groupEpochId_historyKeyId_key" ON "GroupEpochHistoryWrap"("groupEpochId", "historyKeyId");

-- AddForeignKey
ALTER TABLE "RecoveryKey" ADD CONSTRAINT "RecoveryKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHistoryKey" ADD CONSTRAINT "AccountHistoryKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpochHistoryWrap" ADD CONSTRAINT "GroupEpochHistoryWrap_groupEpochId_fkey" FOREIGN KEY ("groupEpochId") REFERENCES "GroupEpoch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpochHistoryWrap" ADD CONSTRAINT "GroupEpochHistoryWrap_historyKeyId_fkey" FOREIGN KEY ("historyKeyId") REFERENCES "AccountHistoryKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpochHistoryWrap" ADD CONSTRAINT "GroupEpochHistoryWrap_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "UserDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
