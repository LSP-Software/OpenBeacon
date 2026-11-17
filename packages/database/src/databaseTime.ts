import type { Prisma } from "../generated/client/client.ts";

export const readDatabaseTime = async (db: Pick<Prisma.TransactionClient, "$queryRaw">) => {
  const [clock] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  if (!clock) throw new Error("Unable to read database time.");
  return clock.now;
};
