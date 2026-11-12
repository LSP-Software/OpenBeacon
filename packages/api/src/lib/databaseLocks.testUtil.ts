import { Prisma, type PrismaClient } from "@openbeacon/database";

export const holdRowLock = async ({
  afterLock,
  beforeCommit,
  db,
  id,
  mode = "FOR UPDATE",
  table,
}: {
  afterLock?: (tx: Prisma.TransactionClient) => Promise<unknown>;
  beforeCommit?: (tx: Prisma.TransactionClient) => Promise<unknown>;
  db: PrismaClient;
  id: string;
  mode?: "FOR NO KEY UPDATE" | "FOR SHARE" | "FOR UPDATE";
  table: "AccountHistoryKey" | "Group" | "User";
}) => {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markLocked = () => {};
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  let holderPid = 0;
  const holder = db.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} ${Prisma.raw(mode)}`,
      );
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      if (!backend) throw new Error("Unable to read the lock holder's backend pid.");
      holderPid = backend.pid;
      await afterLock?.(tx);
      markLocked();
      await released;
      await beforeCommit?.(tx);
    },
    { timeout: 20_000 },
  );
  await Promise.race([locked, holder]);

  return {
    release: async () => {
      release();
      await holder;
    },
    waitForWaiters: async (count: number) => {
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const [row] = await db.$queryRaw<Array<{ waiting: number }>>`
          WITH RECURSIVE blocked(pid) AS (
            SELECT pid FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> ${holderPid}
              AND pg_blocking_pids(pid) @> ARRAY[${holderPid}::int]
            UNION
            SELECT activity.pid FROM pg_stat_activity activity
            JOIN blocked ON pg_blocking_pids(activity.pid) @> ARRAY[blocked.pid]
            WHERE activity.datname = current_database() AND activity.pid <> ${holderPid}
          )
          SELECT count(*)::int AS waiting FROM blocked
        `;
        if ((row?.waiting ?? 0) >= count) return;
        await Bun.sleep(10);
      }
      throw new Error(`Timed out waiting for ${count} lock waiters`);
    },
  };
};
