-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountNoticeType" ADD VALUE 'SIGN_IN_CODES_TURNED_ON';
ALTER TYPE "AccountNoticeType" ADD VALUE 'SIGN_IN_CODES_TURNED_OFF';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "signInCodes" BOOLEAN NOT NULL DEFAULT false;
