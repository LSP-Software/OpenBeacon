-- CreateIndex
CREATE INDEX "GroupEpoch_createdByDeviceId_idx" ON "GroupEpoch"("createdByDeviceId");

-- CreateIndex
CREATE INDEX "GroupEpochRecipientKey_recipientDeviceId_idx" ON "GroupEpochRecipientKey"("recipientDeviceId");
