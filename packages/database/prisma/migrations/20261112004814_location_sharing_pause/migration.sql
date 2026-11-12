ALTER TABLE "User" ADD COLUMN     "sharingChangedAt" TIMESTAMP(3),
ADD COLUMN     "sharingPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sharingPausedUntil" TIMESTAMP(3),
ADD COLUMN     "sharingRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "UserDevice" ADD COLUMN     "sharingChangedAt" TIMESTAMP(3),
ADD COLUMN     "sharingPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sharingPausedUntil" TIMESTAMP(3),
ADD COLUMN     "sharingRevision" INTEGER NOT NULL DEFAULT 0;
