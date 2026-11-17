-- CreateIndex
CREATE INDEX "TrackingStream_epochId_idx" ON "TrackingStream"("epochId");

-- CreateIndex
CREATE INDEX "TrackingStream_senderDeviceId_idx" ON "TrackingStream"("senderDeviceId");

ALTER TABLE "TrackingLatestPoint" SET (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.05);
