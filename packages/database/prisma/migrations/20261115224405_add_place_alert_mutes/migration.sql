-- CreateTable
CREATE TABLE "PlaceAlertMute" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "muterUserId" TEXT NOT NULL,
    "mutedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceAlertMute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaceAlertMute_muterUserId_groupId_idx" ON "PlaceAlertMute"("muterUserId", "groupId");

-- CreateIndex
CREATE INDEX "PlaceAlertMute_mutedUserId_groupId_idx" ON "PlaceAlertMute"("mutedUserId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaceAlertMute_person_key" ON "PlaceAlertMute"("placeId", "muterUserId", "mutedUserId") WHERE ("mutedUserId" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "PlaceAlertMute_everyone_key" ON "PlaceAlertMute"("placeId", "muterUserId") WHERE ("mutedUserId" IS NULL);

-- AddForeignKey
ALTER TABLE "PlaceAlertMute" ADD CONSTRAINT "PlaceAlertMute_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceAlertMute" ADD CONSTRAINT "PlaceAlertMute_muterUserId_groupId_fkey" FOREIGN KEY ("muterUserId", "groupId") REFERENCES "GroupMember"("userId", "groupId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceAlertMute" ADD CONSTRAINT "PlaceAlertMute_mutedUserId_groupId_fkey" FOREIGN KEY ("mutedUserId", "groupId") REFERENCES "GroupMember"("userId", "groupId") ON DELETE CASCADE ON UPDATE CASCADE;
