ALTER TABLE "User" ADD COLUMN     "deletionRetryAt" TIMESTAMP(3);

ALTER TABLE "GroupJoinAlert" ADD COLUMN     "memberId" TEXT;

ALTER TABLE "Feedback" ADD COLUMN     "userId" TEXT;

ALTER TABLE "AccountDeletionCleanup" ADD COLUMN     "retryAt" TIMESTAMP(3);

ALTER TABLE "GroupJoinAlert" ADD CONSTRAINT "GroupJoinAlert_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
