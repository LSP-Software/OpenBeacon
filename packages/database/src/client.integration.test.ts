import { describe, expect, test } from "bun:test";

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("database client timeouts", () => {
  test("statements on the shared client stop after 30 seconds", async () => {
    const { prisma } = await import("./client.ts");
    expect(await prisma.$queryRaw`SHOW statement_timeout`).toEqual([{ statement_timeout: "30s" }]);
  });

  test("a statement that runs past the statement timeout is cancelled", async () => {
    const { createPrismaClient } = await import("./client.ts");
    const db = createPrismaClient({
      connectionString: process.env["DATABASE_URL"] ?? "",
      statement_timeout: 200,
    });
    const start = performance.now();

    await expect(Promise.resolve(db.$queryRaw`SELECT pg_sleep(5)`)).rejects.toThrow(
      "statement timeout",
    );
    expect(performance.now() - start).toBeLessThan(2_000);
    await db.$disconnect();
  });

  test("a query waiting for a free connection gives up at the connection timeout", async () => {
    const { createPrismaClient } = await import("./client.ts");
    const db = createPrismaClient({
      connectionString: process.env["DATABASE_URL"] ?? "",
      max: 1,
      connectionTimeoutMillis: 200,
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = () => {};
    const holding = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transaction = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      started();
      await held;
    });
    await holding;
    const start = performance.now();

    await expect(Promise.resolve(db.$queryRaw`SELECT 1`)).rejects.toThrow(
      "timeout exceeded when trying to connect",
    );
    expect(performance.now() - start).toBeLessThan(2_000);
    release();
    await transaction;
    await db.$disconnect();
  });
});
