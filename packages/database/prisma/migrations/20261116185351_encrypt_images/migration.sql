-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "imageKeyAlgorithm" TEXT,
ADD COLUMN     "imageKeyCiphertext" TEXT,
ADD COLUMN     "imageKeyEpochId" TEXT,
ADD COLUMN     "imageKeyNonce" TEXT,
ADD COLUMN     "imageKeySenderDeviceId" TEXT;

-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN     "imageKeyAlgorithm" TEXT,
ADD COLUMN     "imageKeyCiphertext" TEXT,
ADD COLUMN     "imageKeyEpochId" TEXT,
ADD COLUMN     "imageKeyNonce" TEXT,
ADD COLUMN     "imageKeySenderDeviceId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "imageKeySealed" TEXT;

-- Clear unencrypted pictures
UPDATE "User" SET "image" = NULL, "imageKeySealed" = NULL WHERE "image" IS NOT NULL OR "imageKeySealed" IS NOT NULL;

UPDATE "Group" SET "image" = NULL, "imageKeyEpochId" = NULL, "imageKeySenderDeviceId" = NULL, "imageKeyAlgorithm" = NULL, "imageKeyNonce" = NULL, "imageKeyCiphertext" = NULL WHERE "image" IS NOT NULL OR "imageKeyCiphertext" IS NOT NULL;

UPDATE "GroupMember" SET "imageKeyEpochId" = NULL, "imageKeySenderDeviceId" = NULL, "imageKeyAlgorithm" = NULL, "imageKeyNonce" = NULL, "imageKeyCiphertext" = NULL WHERE "imageKeyCiphertext" IS NOT NULL;
