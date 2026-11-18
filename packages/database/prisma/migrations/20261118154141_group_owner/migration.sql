-- AlterEnum
ALTER TYPE "AccountNoticeType" ADD VALUE 'OWNERSHIP_OFFERED';

-- AlterEnum
ALTER TYPE "GroupEventType" ADD VALUE 'OWNER_CHANGED';

-- AlterEnum
ALTER TYPE "GroupRole" RENAME VALUE 'ADMIN' TO 'EDITOR';
ALTER TYPE "GroupRole" RENAME VALUE 'OWNER' TO 'ADMIN';

-- AlterTable
ALTER TABLE "AccountNotice" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "ownershipOfferedAt" TIMESTAMP(3),
ADD COLUMN     "ownershipOfferedToId" TEXT;

-- Backfill
UPDATE "Group" AS "group"
SET "ownerId" = (
  SELECT "member"."userId"
  FROM "GroupMember" AS "member"
  JOIN "User" AS "user" ON "user"."id" = "member"."userId"
  WHERE "member"."groupId" = "group"."id"
  ORDER BY "user"."pendingDeletion", "member"."role", "member"."createdAt", "member"."id"
  LIMIT 1
);

UPDATE "GroupMember" AS "member"
SET "role" = 'ADMIN'
FROM "Group" AS "group"
WHERE "member"."groupId" = "group"."id"
  AND "member"."userId" = "group"."ownerId"
  AND "member"."role" <> 'ADMIN';

DELETE FROM "Group" WHERE "ownerId" IS NULL;

ALTER TABLE "Group" ALTER COLUMN "ownerId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "AccountNotice_groupId_idx" ON "AccountNotice"("groupId");

-- CreateIndex
CREATE INDEX "Group_ownerId_idx" ON "Group"("ownerId");

-- CreateIndex
CREATE INDEX "Group_ownershipOfferedToId_idx" ON "Group"("ownershipOfferedToId");

-- AddForeignKey
ALTER TABLE "AccountNotice" ADD CONSTRAINT "AccountNotice_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_ownershipOfferedToId_fkey" FOREIGN KEY ("ownershipOfferedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
