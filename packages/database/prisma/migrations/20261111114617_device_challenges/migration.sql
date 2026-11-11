-- CreateEnum
CREATE TYPE "DeviceChallengePurpose" AS ENUM ('activation', 'sessionLink');

-- CreateTable
CREATE TABLE "DeviceChallenge" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "purpose" "DeviceChallengePurpose" NOT NULL,
    "challengeHash" TEXT NOT NULL,
    "historyKeyVersion" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceChallenge_sessionId_key" ON "DeviceChallenge"("sessionId");

-- CreateIndex
CREATE INDEX "DeviceChallenge_deviceId_purpose_idx" ON "DeviceChallenge"("deviceId", "purpose");

-- CreateIndex
CREATE INDEX "DeviceChallenge_expiresAt_idx" ON "DeviceChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "DeviceChallenge" ADD CONSTRAINT "DeviceChallenge_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceChallenge" ADD CONSTRAINT "DeviceChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
