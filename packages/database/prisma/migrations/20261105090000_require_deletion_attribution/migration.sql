ALTER TABLE "GroupJoinAlert" ADD CONSTRAINT "GroupJoinAlert_memberId_required" CHECK ("memberId" IS NOT NULL) NOT VALID;
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_required" CHECK ("userId" IS NOT NULL) NOT VALID;
ALTER TABLE "GroupSharedInvite" ADD CONSTRAINT "GroupSharedInvite_creatorId_required" CHECK ("creatorId" IS NOT NULL) NOT VALID;
