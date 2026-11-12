-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_kind_createdAt_idx" ON "GroupEncryptedPayload"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "GroupEpoch_createdAt_id_idx" ON "GroupEpoch"("createdAt", "id");
