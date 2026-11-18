import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Prisma, prisma } from "@openbeacon/database";
import { retryOnTransactionConflict } from "./retryOnTransactionConflict.ts";

const prefix = `transaction-conflict-${crypto.randomUUID()}`;
const first = `${prefix}-a`;
const second = `${prefix}-b`;

const lockBothInTurn = () => {
  let bothLocked = () => {};
  const locked = new Promise<void>((resolve) => {
    bothLocked = resolve;
  });
  let holding = 0;
  let runs = 0;
  const lock = (ids: [string, string]) => () =>
    prisma.$transaction(async (tx) => {
      runs += 1;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Group" WHERE id = ${ids[0]} FOR UPDATE`);
      holding += 1;
      if (holding === 2) bothLocked();
      await locked;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Group" WHERE id = ${ids[1]} FOR UPDATE`);
      return "done";
    });
  return { lock, runs: () => runs };
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "retrying a transaction that PostgreSQL picked as a deadlock victim",
  () => {
    beforeAll(async () => {
      await prisma.group.createMany({
        data: [
          { id: first, name: "First" },
          { id: second, name: "Second" },
        ],
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.$disconnect();
    });

    test("the victim of a deadlock between raw row locks runs again and succeeds", async () => {
      const { lock, runs } = lockBothInTurn();
      expect(
        await Promise.all([
          retryOnTransactionConflict(lock([first, second])),
          retryOnTransactionConflict(lock([second, first])),
        ]),
      ).toEqual(["done", "done"]);
      expect(runs()).toBe(3);
    });

    test("other errors are not retried", async () => {
      let runs = 0;
      const failing = retryOnTransactionConflict(() => {
        runs += 1;
        return prisma.group.create({ data: { id: first, name: "Duplicate" } });
      });
      await expect(failing).rejects.toMatchObject({ code: "P2002" });
      expect(runs).toBe(1);
    });
  },
);
