import { Prisma } from "@openbeacon/database";

export const deletePayloadsInBatches = async ({
  db,
  where,
  orderBy = Prisma.empty,
  batchSize = 5_000,
  limit = Number.POSITIVE_INFINITY,
}: {
  db: Pick<Prisma.TransactionClient, "$executeRaw">;
  where: Prisma.Sql;
  orderBy?: Prisma.Sql;
  batchSize?: number;
  limit?: number;
}) => {
  let deleted = 0;
  while (deleted < limit) {
    const take = Math.min(batchSize, limit - deleted);
    const count = await db.$executeRaw(Prisma.sql`
      DELETE FROM "GroupEncryptedPayload"
      WHERE id = ANY(ARRAY(
        SELECT id FROM "GroupEncryptedPayload"
        WHERE ${where}
        ${orderBy}
        LIMIT ${take}
        FOR UPDATE SKIP LOCKED
      ))
    `);
    deleted += count;
    if (count < take) return deleted;
  }
  return deleted;
};
