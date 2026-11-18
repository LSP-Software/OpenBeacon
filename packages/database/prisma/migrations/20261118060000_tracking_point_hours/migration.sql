CREATE TABLE "TrackingPoint_hours" (
    "streamId" BIGINT NOT NULL,
    "pointId" BIGINT NOT NULL,
    "receivedHour" INTEGER NOT NULL,
    "capturedHour" INTEGER NOT NULL,
    "payload" BYTEA NOT NULL
);

INSERT INTO "TrackingPoint_hours" ("streamId", "pointId", "receivedHour", "capturedHour", "payload")
SELECT "streamId", "pointId",
    floor(extract(epoch FROM "receivedAt") / 3600)::integer,
    floor(extract(epoch FROM "receivedAt") / 3600)::integer,
    "payload"
FROM "TrackingPoint";

DROP TABLE "TrackingPoint";

ALTER TABLE "TrackingPoint_hours" RENAME TO "TrackingPoint";

ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_pkey" PRIMARY KEY ("streamId", "pointId");

-- CreateIndex
CREATE INDEX "TrackingPoint_streamId_capturedHour_idx" ON "TrackingPoint"("streamId", "capturedHour");

-- AddForeignKey
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "TrackingStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrackingPoint" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 1000);
