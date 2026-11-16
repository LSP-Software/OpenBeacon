-- CreateEnum
CREATE TYPE "PlaceTransitionDirection" AS ENUM ('ARRIVE', 'LEAVE');

-- CreateTable
CREATE TABLE "PlaceTransition" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "direction" "PlaceTransitionDirection" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceSharing" (
    "deviceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaceSharing_pkey" PRIMARY KEY ("deviceId","groupId")
);

-- CreateIndex
CREATE INDEX "PlaceTransition_groupId_createdAt_id_idx" ON "PlaceTransition"("groupId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PlaceTransition_groupId_occurredAt_id_idx" ON "PlaceTransition"("groupId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "PlaceTransition_placeId_idx" ON "PlaceTransition"("placeId");

-- CreateIndex
CREATE INDEX "PlaceTransition_occurredAt_idx" ON "PlaceTransition"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlaceTransition_deviceId_clientId_key" ON "PlaceTransition"("deviceId", "clientId");

-- CreateIndex
CREATE INDEX "PlaceSharing_userId_groupId_idx" ON "PlaceSharing"("userId", "groupId");

-- CreateIndex
CREATE INDEX "PlaceSharing_groupId_idx" ON "PlaceSharing"("groupId");

-- AddForeignKey
ALTER TABLE "PlaceTransition" ADD CONSTRAINT "PlaceTransition_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceTransition" ADD CONSTRAINT "PlaceTransition_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceSharing" ADD CONSTRAINT "PlaceSharing_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceSharing" ADD CONSTRAINT "PlaceSharing_userId_groupId_fkey" FOREIGN KEY ("userId", "groupId") REFERENCES "GroupMember"("userId", "groupId") ON DELETE CASCADE ON UPDATE CASCADE;
