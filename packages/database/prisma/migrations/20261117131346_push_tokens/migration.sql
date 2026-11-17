-- CreateTable
CREATE TABLE "PushToken" (
    "deviceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("deviceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
