CREATE TABLE "PersonalGroupNickname" (
  "ownerId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  CONSTRAINT "PersonalGroupNickname_pkey" PRIMARY KEY ("ownerId", "targetId"),
  CONSTRAINT "PersonalGroupNickname_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PersonalGroupNickname_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
