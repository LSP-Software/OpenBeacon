-- CreateTable
CREATE TABLE "DeviceLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "approverDeviceId" TEXT,
    "enc" TEXT,
    "ciphertext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLink_deviceId_key" ON "DeviceLink"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceLink_userId_idx" ON "DeviceLink"("userId");

-- CreateIndex
CREATE INDEX "DeviceLink_approverDeviceId_idx" ON "DeviceLink"("approverDeviceId");

-- CreateIndex
CREATE INDEX "DeviceLink_expiresAt_idx" ON "DeviceLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_approverDeviceId_fkey" FOREIGN KEY ("approverDeviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
