import { afterAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { appRouter } from "../root.ts";

const prefix = `feedback-test-${crypto.randomUUID()}`;
const caller = appRouter.createCaller({
  cache: createIntegrationTestCache(() => 0),
  clientIp: "127.0.0.1",
  db: prisma,
  serverVersion: "9.9.9",
  selfHosted: false,
  session: null,
} as unknown as Parameters<typeof appRouter.createCaller>[0]);

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("feedback with PostgreSQL", () => {
  afterAll(async () => {
    await prisma.feedback.deleteMany({ where: { message: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  test("persists anonymous feedback with diagnostics and optional email", async () => {
    await caller.feedback.submit({
      message: ` ${prefix}-private `,
      androidVersion: " 17 ",
      appVersion: " 1.0.0 ",
      maplibreVersion: " 10.4.2 ",
      mapVersion: " 2026-11-01 (b) ",
      serverVersion: "0.1.1",
    });
    await caller.feedback.submit({
      message: `${prefix}-contact`,
      email: `${prefix}@example.test`,
    });
    const records = await prisma.feedback.findMany({ where: { message: { startsWith: prefix } } });
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.message === `${prefix}-private`)).toMatchObject({
      userId: null,
      email: null,
      androidVersion: "17",
      appVersion: "1.0.0",
      maplibreVersion: "10.4.2",
      mapVersion: "2026-11-01 (b)",
      serverVersion: "0.1.1",
    });
    expect(records.find((record) => record.message === `${prefix}-contact`)).toMatchObject({
      userId: null,
      email: `${prefix}@example.test`,
      androidVersion: null,
      appVersion: null,
      maplibreVersion: null,
      mapVersion: null,
      serverVersion: null,
    });
  });
});
