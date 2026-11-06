CREATE TABLE "AccountDeletionCleanup" (
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionCleanup_pkey" PRIMARY KEY ("userId")
);
