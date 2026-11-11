-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_groupId_senderDeviceId_createdAt_idx" ON "GroupEncryptedPayload"("groupId", "senderDeviceId", "createdAt");
