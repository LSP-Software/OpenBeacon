/*
  Warnings:

  - You are about to drop the `GroupJoinAlert` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "GroupEventType" AS ENUM ('GROUP_CREATED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'ACCOUNT_DELETED', 'ROLE_CHANGED', 'GROUP_RENAMED', 'GROUP_IMAGE_CHANGED', 'PLACE_ADDED', 'PLACE_UPDATED', 'PLACE_DELETED');

-- DropForeignKey
ALTER TABLE "GroupJoinAlert" DROP CONSTRAINT "GroupJoinAlert_groupId_fkey";

-- DropForeignKey
ALTER TABLE "GroupJoinAlert" DROP CONSTRAINT "GroupJoinAlert_memberId_fkey";

-- DropForeignKey
ALTER TABLE "GroupJoinAlert" DROP CONSTRAINT "GroupJoinAlert_recipientId_fkey";

-- DropTable
DROP TABLE "GroupJoinAlert";

-- CreateTable
CREATE TABLE "GroupEvent" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" "GroupEventType" NOT NULL,
    "actorUserId" TEXT,
    "subjectUserId" TEXT,
    "role" "GroupRole",
    "name" TEXT,
    "previousName" TEXT,
    "emoji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupEvent_groupId_createdAt_id_idx" ON "GroupEvent"("groupId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "GroupEvent_actorUserId_idx" ON "GroupEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "GroupEvent_subjectUserId_idx" ON "GroupEvent"("subjectUserId");

-- CreateIndex
CREATE INDEX "GroupEvent_createdAt_idx" ON "GroupEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "GroupEvent" ADD CONSTRAINT "GroupEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEvent" ADD CONSTRAINT "GroupEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEvent" ADD CONSTRAINT "GroupEvent_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
