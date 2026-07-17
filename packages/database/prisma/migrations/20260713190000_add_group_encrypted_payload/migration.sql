-- CreateTable
CREATE TABLE "GroupEncryptedPayload" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "epochId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "clientPointId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupEncryptedPayload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_groupId_createdAt_id_idx" ON "GroupEncryptedPayload"("groupId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_groupId_senderUserId_createdAt_idx" ON "GroupEncryptedPayload"("groupId", "senderUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroupEncryptedPayload_groupId_clientPointId_key" ON "GroupEncryptedPayload"("groupId", "clientPointId");

-- AddForeignKey
ALTER TABLE "GroupEncryptedPayload" ADD CONSTRAINT "GroupEncryptedPayload_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEncryptedPayload" ADD CONSTRAINT "GroupEncryptedPayload_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "GroupEpoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEncryptedPayload" ADD CONSTRAINT "GroupEncryptedPayload_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "UserDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEncryptedPayload" ADD CONSTRAINT "GroupEncryptedPayload_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
