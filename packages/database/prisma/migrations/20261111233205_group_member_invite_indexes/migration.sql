-- CreateIndex
CREATE INDEX "GroupMemberInvite_groupId_inviterId_idx" ON "GroupMemberInvite"("groupId", "inviterId");

-- CreateIndex
CREATE INDEX "GroupMemberInvite_inviterId_idx" ON "GroupMemberInvite"("inviterId");
