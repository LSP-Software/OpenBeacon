-- CreateTable
CREATE TABLE "GoogleDeletionChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleDeletionChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoogleDeletionChallenge_userId_idx" ON "GoogleDeletionChallenge"("userId");

-- CreateIndex
CREATE INDEX "GoogleDeletionChallenge_sessionId_idx" ON "GoogleDeletionChallenge"("sessionId");

-- AddForeignKey
ALTER TABLE "GoogleDeletionChallenge" ADD CONSTRAINT "GoogleDeletionChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleDeletionChallenge" ADD CONSTRAINT "GoogleDeletionChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
