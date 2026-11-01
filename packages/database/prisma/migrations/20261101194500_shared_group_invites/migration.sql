CREATE TABLE "GroupSharedInvite" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupSharedInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupSharedInvite_codeHash_key" ON "GroupSharedInvite"("codeHash");

ALTER TABLE "GroupSharedInvite" ADD CONSTRAINT "GroupSharedInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
