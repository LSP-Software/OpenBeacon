ALTER TABLE "GroupSharedInvite" ADD COLUMN     "creatorId" TEXT;

ALTER TABLE "GroupSharedInvite" ADD CONSTRAINT "GroupSharedInvite_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
