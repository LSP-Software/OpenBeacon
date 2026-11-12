-- CreateEnum
CREATE TYPE "DeviceIcon" AS ENUM ('phone', 'tablet', 'watch', 'car', 'laptop', 'bag', 'tag', 'home');

-- CreateEnum
CREATE TYPE "DeviceActivation" AS ENUM ('firstDevice', 'link', 'phrase', 'reset', 'existing');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deviceId" TEXT;

-- AlterTable
ALTER TABLE "UserDevice" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "activatedBy" "DeviceActivation",
ADD COLUMN     "icon" "DeviceIcon",
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT;

-- Backfill
UPDATE "UserDevice"
SET "name" = COALESCE(LEFT(NULLIF(TRIM("model"), ''), 40), 'Phone'),
    "icon" = CASE WHEN "model" ~ '(iPad|Tab)' THEN 'tablet'::"DeviceIcon" ELSE 'phone'::"DeviceIcon" END;

UPDATE "UserDevice"
SET "activatedAt" = "createdAt",
    "activatedBy" = 'existing'
WHERE "revokedAt" IS NULL;

ALTER TABLE "UserDevice" ALTER COLUMN "name" SET NOT NULL,
ALTER COLUMN "icon" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Session_deviceId_idx" ON "Session"("deviceId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
