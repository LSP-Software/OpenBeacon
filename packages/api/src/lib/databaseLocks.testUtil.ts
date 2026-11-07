import { Prisma, type PrismaClient } from "@openbeacon/database";

export const holdRowLock = async ({
  db,
  id,
  table,
}: {
  db: PrismaClient;
  id: string;
  table: "Group" | "User";
}) => {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markLocked = () => {};
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  const holder = db.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} FOR UPDATE`,
      );
      markLocked();
      await released;
    },
    { timeout: 20_000 },
  );
  await locked;

  return {
    release: async () => {
      release();
      await holder;
    },
    waitForWaiters: async (count: number) => {
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const [row] = await db.$queryRaw<Array<{ waiting: number }>>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `;
        if ((row?.waiting ?? 0) >= count) return;
        await Bun.sleep(10);
      }
      throw new Error(`Timed out waiting for ${count} lock waiters`);
    },
  };
};
