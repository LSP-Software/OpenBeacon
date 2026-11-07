DELETE FROM "PersonalGroupNickname";

CREATE TABLE "PersonalGroupColor" (
  "ownerId" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  CONSTRAINT "PersonalGroupColor_pkey" PRIMARY KEY ("ownerId"),
  CONSTRAINT "PersonalGroupColor_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
