/*
  Warnings:

  - The values [existing] on the enum `DeviceActivation` will be removed. If these variants are still used in the database, this will fail.
  - The values [watch,car,laptop,bag,tag,home] on the enum `DeviceIcon` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `userId` on the `Feedback` table. All the data in the column will be lost.
  - Made the column `creatorId` on table `GroupSharedInvite` required. This step will fail if there are existing NULL values in that column.

*/
UPDATE "UserDevice" SET "activatedBy" = NULL WHERE "activatedBy" = 'existing';
UPDATE "UserDevice" SET "icon" = 'phone' WHERE "icon" IN ('watch', 'car', 'laptop', 'bag', 'tag', 'home');
DELETE FROM "GroupSharedInvite" WHERE "creatorId" IS NULL;

-- AlterEnum
BEGIN;
CREATE TYPE "DeviceActivation_new" AS ENUM ('firstDevice', 'link', 'phrase', 'reset');
ALTER TABLE "UserDevice" ALTER COLUMN "activatedBy" TYPE "DeviceActivation_new" USING ("activatedBy"::text::"DeviceActivation_new");
ALTER TYPE "DeviceActivation" RENAME TO "DeviceActivation_old";
ALTER TYPE "DeviceActivation_new" RENAME TO "DeviceActivation";
DROP TYPE "DeviceActivation_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "DeviceIcon_new" AS ENUM ('phone', 'tablet', 'phoneClassic', 'tabletPortrait', 'star', 'heart', 'flower', 'sun');
ALTER TABLE "UserDevice" ALTER COLUMN "icon" TYPE "DeviceIcon_new" USING ("icon"::text::"DeviceIcon_new");
ALTER TYPE "DeviceIcon" RENAME TO "DeviceIcon_old";
ALTER TYPE "DeviceIcon_new" RENAME TO "DeviceIcon";
DROP TYPE "DeviceIcon_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_userId_fkey";

-- DropIndex
DROP INDEX "Feedback_userId_idx";

-- DropIndex
DROP INDEX "GroupEpoch_groupId_createdAt_idx";

-- AlterTable
ALTER TABLE "Feedback" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "GroupSharedInvite" ALTER COLUMN "creatorId" SET NOT NULL;
ALTER TABLE "GroupSharedInvite" DROP CONSTRAINT "GroupSharedInvite_creatorId_required";
