-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_epochId_idx" ON "GroupEncryptedPayload"("epochId");

-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_senderDeviceId_idx" ON "GroupEncryptedPayload"("senderDeviceId");

-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_senderUserId_idx" ON "GroupEncryptedPayload"("senderUserId");
