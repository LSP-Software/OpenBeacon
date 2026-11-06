ALTER TABLE "Group" ADD COLUMN     "epochRotationRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minimumUploadEpoch" INTEGER NOT NULL DEFAULT 1;
