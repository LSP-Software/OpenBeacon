CREATE TABLE "GroupJoinAlert" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupJoinAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GroupJoinAlert_recipientId_createdAt_idx" ON "GroupJoinAlert"("recipientId", "createdAt");

ALTER TABLE "GroupJoinAlert" ADD CONSTRAINT "GroupJoinAlert_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupJoinAlert" ADD CONSTRAINT "GroupJoinAlert_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
