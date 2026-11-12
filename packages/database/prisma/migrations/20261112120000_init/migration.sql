-- CreateEnum
CREATE TYPE "ImageUploadType" AS ENUM ('userAvatar', 'groupAvatar');

-- CreateEnum
CREATE TYPE "DeviceChallengePurpose" AS ENUM ('activation', 'sessionLink');

-- CreateEnum
CREATE TYPE "DeviceIcon" AS ENUM ('phone', 'tablet', 'watch', 'car', 'laptop', 'bag', 'tag', 'home', 'phoneClassic', 'tabletPortrait', 'star', 'heart', 'flower', 'sun');

-- CreateEnum
CREATE TYPE "DeviceActivation" AS ENUM ('firstDevice', 'link', 'phrase', 'reset', 'existing');

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pendingDeletion" BOOLEAN NOT NULL DEFAULT false,
    "deletionCancellationPending" BOOLEAN NOT NULL DEFAULT false,
    "deletionRetryAt" TIMESTAMP(3),
    "deletionDate" TIMESTAMP(3),
    "timezone" TEXT,
    "alertNewSignIn" BOOLEAN NOT NULL DEFAULT true,
    "alertDeletionScheduled" BOOLEAN NOT NULL DEFAULT true,
    "sharingPaused" BOOLEAN NOT NULL DEFAULT false,
    "sharingPausedUntil" TIMESTAMP(3),
    "sharingChangedAt" TIMESTAMP(3),
    "sharingRevision" INTEGER NOT NULL DEFAULT 0,
    "sharingRequestId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "epochRotationRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingUpload" (
    "userId" TEXT NOT NULL,
    "uploadType" "ImageUploadType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupId" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("userId","uploadType","groupId")
);

-- CreateTable
CREATE TABLE "GroupMemberInvite" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMemberInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSharedInvite" (
    "creatorId" TEXT,
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupSharedInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupJoinAlert" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "memberId" TEXT,
    "groupId" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupJoinAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL,
    "joinedEpochNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalGroupNickname" (
    "ownerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,

    CONSTRAINT "PersonalGroupNickname_pkey" PRIMARY KEY ("ownerId","targetId")
);

-- CreateTable
CREATE TABLE "PersonalGroupColor" (
    "ownerId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,

    CONSTRAINT "PersonalGroupColor_pkey" PRIMARY KEY ("ownerId")
);

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "publicKeyAlgorithm" TEXT NOT NULL,
    "platform" TEXT,
    "model" TEXT,
    "name" TEXT NOT NULL,
    "icon" "DeviceIcon" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLocationAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "activatedBy" "DeviceActivation",
    "revokedAt" TIMESTAMP(3),
    "sharingPaused" BOOLEAN NOT NULL DEFAULT false,
    "sharingPausedUntil" TIMESTAMP(3),
    "sharingChangedAt" TIMESTAMP(3),
    "sharingRevision" INTEGER NOT NULL DEFAULT 0,
    "sharingRequestId" TEXT,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "GroupEpoch" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "epochNumber" INTEGER NOT NULL,
    "createdByDeviceId" TEXT,
    "senderPublicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupEpoch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupEncryptedPayload" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "epochId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "clientPointId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupEncryptedPayload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupEpochRecipientKey" (
    "id" TEXT NOT NULL,
    "groupEpochId" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "ephemeralPublicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupEpochRecipientKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryKey" (
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "derivationVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryKey_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AccountHistoryKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "escrowEnc" TEXT,
    "escrowCiphertext" TEXT,
    "escrowAlgorithm" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountHistoryKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupEpochHistoryWrap" (
    "id" TEXT NOT NULL,
    "groupEpochId" TEXT NOT NULL,
    "historyKeyId" TEXT NOT NULL,
    "senderDeviceId" TEXT,
    "senderPublicKey" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "ephemeralPublicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupEpochHistoryWrap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "userId" TEXT,
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "email" TEXT,
    "androidVersion" TEXT,
    "appVersion" TEXT,
    "maplibreVersion" TEXT,
    "mapVersion" TEXT,
    "serverVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionCleanup" (
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryAt" TIMESTAMP(3),
    "imageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "AccountDeletionCleanup_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_pendingDeletion_deletionDate_idx" ON "User"("pendingDeletion", "deletionDate");

-- CreateIndex
CREATE INDEX "User_image_idx" ON "User"("image");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_deviceId_idx" ON "Session"("deviceId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "GoogleDeletionChallenge_userId_idx" ON "GoogleDeletionChallenge"("userId");

-- CreateIndex
CREATE INDEX "GoogleDeletionChallenge_sessionId_idx" ON "GoogleDeletionChallenge"("sessionId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "Group_image_idx" ON "Group"("image");

-- CreateIndex
CREATE INDEX "PendingUpload_groupId_idx" ON "PendingUpload"("groupId");

-- CreateIndex
CREATE INDEX "GroupMemberInvite_groupId_inviterId_idx" ON "GroupMemberInvite"("groupId", "inviterId");

-- CreateIndex
CREATE INDEX "GroupMemberInvite_inviterId_idx" ON "GroupMemberInvite"("inviterId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMemberInvite_recipientId_groupId_key" ON "GroupMemberInvite"("recipientId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSharedInvite_codeHash_key" ON "GroupSharedInvite"("codeHash");

-- CreateIndex
CREATE INDEX "GroupSharedInvite_groupId_idx" ON "GroupSharedInvite"("groupId");

-- CreateIndex
CREATE INDEX "GroupSharedInvite_creatorId_idx" ON "GroupSharedInvite"("creatorId");

-- CreateIndex
CREATE INDEX "GroupJoinAlert_recipientId_createdAt_idx" ON "GroupJoinAlert"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "GroupJoinAlert_groupId_idx" ON "GroupJoinAlert"("groupId");

-- CreateIndex
CREATE INDEX "GroupJoinAlert_memberId_idx" ON "GroupJoinAlert"("memberId");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_idx" ON "GroupMember"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_userId_groupId_key" ON "GroupMember"("userId", "groupId");

-- CreateIndex
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLink_deviceId_key" ON "DeviceLink"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceLink_userId_idx" ON "DeviceLink"("userId");

-- CreateIndex
CREATE INDEX "DeviceLink_approverDeviceId_idx" ON "DeviceLink"("approverDeviceId");

-- CreateIndex
CREATE INDEX "DeviceLink_expiresAt_idx" ON "DeviceLink"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceChallenge_sessionId_key" ON "DeviceChallenge"("sessionId");

-- CreateIndex
CREATE INDEX "DeviceChallenge_deviceId_purpose_idx" ON "DeviceChallenge"("deviceId", "purpose");

-- CreateIndex
CREATE INDEX "DeviceChallenge_expiresAt_idx" ON "DeviceChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "GroupEpoch_groupId_createdAt_idx" ON "GroupEpoch"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "GroupEpoch_createdAt_id_idx" ON "GroupEpoch"("createdAt", "id");

-- CreateIndex
CREATE INDEX "GroupEpoch_createdByDeviceId_idx" ON "GroupEpoch"("createdByDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupEpoch_groupId_epochNumber_key" ON "GroupEpoch"("groupId", "epochNumber");

-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_groupId_createdAt_id_idx" ON "GroupEncryptedPayload"("groupId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_kind_createdAt_idx" ON "GroupEncryptedPayload"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_senderDeviceId_groupId_createdAt_id_idx" ON "GroupEncryptedPayload"("senderDeviceId", "groupId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_senderUserId_groupId_idx" ON "GroupEncryptedPayload"("senderUserId", "groupId");

-- CreateIndex
CREATE INDEX "GroupEncryptedPayload_epochId_idx" ON "GroupEncryptedPayload"("epochId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupEncryptedPayload_groupId_clientPointId_key" ON "GroupEncryptedPayload"("groupId", "clientPointId");

-- CreateIndex
CREATE INDEX "GroupEpochRecipientKey_recipientDeviceId_idx" ON "GroupEpochRecipientKey"("recipientDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupEpochRecipientKey_groupEpochId_recipientDeviceId_key" ON "GroupEpochRecipientKey"("groupEpochId", "recipientDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountHistoryKey_userId_version_key" ON "AccountHistoryKey"("userId", "version");

-- CreateIndex
CREATE INDEX "GroupEpochHistoryWrap_historyKeyId_idx" ON "GroupEpochHistoryWrap"("historyKeyId");

-- CreateIndex
CREATE INDEX "GroupEpochHistoryWrap_senderDeviceId_idx" ON "GroupEpochHistoryWrap"("senderDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupEpochHistoryWrap_groupEpochId_historyKeyId_key" ON "GroupEpochHistoryWrap"("groupEpochId", "historyKeyId");

-- CreateIndex
CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleDeletionChallenge" ADD CONSTRAINT "GoogleDeletionChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleDeletionChallenge" ADD CONSTRAINT "GoogleDeletionChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMemberInvite" ADD CONSTRAINT "GroupMemberInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMemberInvite" ADD CONSTRAINT "GroupMemberInvite_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMemberInvite" ADD CONSTRAINT "GroupMemberInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSharedInvite" ADD CONSTRAINT "GroupSharedInvite_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSharedInvite" ADD CONSTRAINT "GroupSharedInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupJoinAlert" ADD CONSTRAINT "GroupJoinAlert_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupJoinAlert" ADD CONSTRAINT "GroupJoinAlert_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupJoinAlert" ADD CONSTRAINT "GroupJoinAlert_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalGroupNickname" ADD CONSTRAINT "PersonalGroupNickname_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalGroupNickname" ADD CONSTRAINT "PersonalGroupNickname_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalGroupColor" ADD CONSTRAINT "PersonalGroupColor_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_approverDeviceId_fkey" FOREIGN KEY ("approverDeviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceChallenge" ADD CONSTRAINT "DeviceChallenge_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceChallenge" ADD CONSTRAINT "DeviceChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpoch" ADD CONSTRAINT "GroupEpoch_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpoch" ADD CONSTRAINT "GroupEpoch_createdByDeviceId_fkey" FOREIGN KEY ("createdByDeviceId") REFERENCES "UserDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEncryptedPayload" ADD CONSTRAINT "GroupEncryptedPayload_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEncryptedPayload" ADD CONSTRAINT "GroupEncryptedPayload_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "GroupEpoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEncryptedPayload" ADD CONSTRAINT "GroupEncryptedPayload_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "UserDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEncryptedPayload" ADD CONSTRAINT "GroupEncryptedPayload_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpochRecipientKey" ADD CONSTRAINT "GroupEpochRecipientKey_groupEpochId_fkey" FOREIGN KEY ("groupEpochId") REFERENCES "GroupEpoch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpochRecipientKey" ADD CONSTRAINT "GroupEpochRecipientKey_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "UserDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryKey" ADD CONSTRAINT "RecoveryKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHistoryKey" ADD CONSTRAINT "AccountHistoryKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpochHistoryWrap" ADD CONSTRAINT "GroupEpochHistoryWrap_groupEpochId_fkey" FOREIGN KEY ("groupEpochId") REFERENCES "GroupEpoch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpochHistoryWrap" ADD CONSTRAINT "GroupEpochHistoryWrap_historyKeyId_fkey" FOREIGN KEY ("historyKeyId") REFERENCES "AccountHistoryKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEpochHistoryWrap" ADD CONSTRAINT "GroupEpochHistoryWrap_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "UserDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddCheckConstraints
ALTER TABLE "GroupJoinAlert" ADD CONSTRAINT "GroupJoinAlert_memberId_required" CHECK ("memberId" IS NOT NULL);
ALTER TABLE "GroupSharedInvite" ADD CONSTRAINT "GroupSharedInvite_creatorId_required" CHECK ("creatorId" IS NOT NULL);
ALTER TABLE "AccountHistoryKey" ADD CONSTRAINT "AccountHistoryKey_escrow_complete" CHECK (
  ("escrowEnc" IS NULL AND "escrowCiphertext" IS NULL AND "escrowAlgorithm" IS NULL)
  OR ("escrowEnc" IS NOT NULL AND "escrowCiphertext" IS NOT NULL AND "escrowAlgorithm" IS NOT NULL)
);

-- TuneAutovacuum
ALTER TABLE "GroupEncryptedPayload" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 1000);
