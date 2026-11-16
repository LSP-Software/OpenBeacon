-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "placesRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "epochId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Place_groupId_createdAt_idx" ON "Place"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "Place_epochId_idx" ON "Place"("epochId");

-- CreateIndex
CREATE INDEX "Place_createdByUserId_idx" ON "Place"("createdByUserId");

-- CreateIndex
CREATE INDEX "Place_updatedByUserId_idx" ON "Place"("updatedByUserId");

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
