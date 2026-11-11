-- AlterTable
ALTER TABLE "AccountHistoryKey" ALTER COLUMN "escrowEnc" DROP NOT NULL,
ALTER COLUMN "escrowCiphertext" DROP NOT NULL,
ALTER COLUMN "escrowAlgorithm" DROP NOT NULL;

ALTER TABLE "AccountHistoryKey" ADD CONSTRAINT "AccountHistoryKey_escrow_complete" CHECK (
  ("escrowEnc" IS NULL AND "escrowCiphertext" IS NULL AND "escrowAlgorithm" IS NULL)
  OR ("escrowEnc" IS NOT NULL AND "escrowCiphertext" IS NOT NULL AND "escrowAlgorithm" IS NOT NULL)
);
