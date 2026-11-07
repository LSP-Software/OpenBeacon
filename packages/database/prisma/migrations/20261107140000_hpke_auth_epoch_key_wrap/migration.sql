DELETE FROM "GroupEpochRecipientKey";

ALTER TABLE "GroupEpochRecipientKey" DROP COLUMN "nonce";

ALTER TABLE "GroupEpoch" ADD COLUMN "senderPublicKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GroupEpoch" ALTER COLUMN "senderPublicKey" DROP DEFAULT;

UPDATE "Group" SET "epochRotationRequired" = true
WHERE EXISTS (SELECT 1 FROM "GroupEpoch" WHERE "GroupEpoch"."groupId" = "Group"."id");
