ALTER TABLE "GroupEpoch" DROP CONSTRAINT "GroupEpoch_createdByDeviceId_fkey";

ALTER TABLE "User" ADD COLUMN     "deletionDate" TIMESTAMP(3),
ADD COLUMN     "pendingDeletion" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GroupEpoch" ALTER COLUMN "createdByDeviceId" DROP NOT NULL;

CREATE INDEX "User_pendingDeletion_deletionDate_idx" ON "User"("pendingDeletion", "deletionDate");

ALTER TABLE "GroupEpoch" ADD CONSTRAINT "GroupEpoch_createdByDeviceId_fkey" FOREIGN KEY ("createdByDeviceId") REFERENCES "UserDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
