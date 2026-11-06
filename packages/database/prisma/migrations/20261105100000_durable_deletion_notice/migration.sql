ALTER TABLE "User" ADD COLUMN     "deletionCancellationPending" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "deletionCancellationPending" = true WHERE EXISTS (SELECT 1 FROM "Session" WHERE "Session"."userId" = "User"."id" AND "Session"."deletionCancelled" = true);

ALTER TABLE "Session" DROP COLUMN "deletionCancelled";
