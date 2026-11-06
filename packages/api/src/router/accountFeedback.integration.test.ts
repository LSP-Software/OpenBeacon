import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import { appRouter } from "../root.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const prefix = `feedback-test-${crypto.randomUUID()}`;
const caller = appRouter.createCaller({
  cache: new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 }),
  clientIp: "127.0.0.1",
  db: prisma,
  serverVersion: "0.1.1",
  session: { user: { id: prefix, email: `${prefix}@example.test` } },
} as Parameters<typeof appRouter.createCaller>[0]);

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("feedback with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: prefix, name: "Feedback", email: `${prefix}@example.test` },
    });
  });
  afterAll(async () => {
    await prisma.feedback.deleteMany({ where: { message: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  test("persists version diagnostics and respects email consent", async () => {
    await caller.account.submitFeedback({
      message: ` ${prefix}-private `,
      includeEmail: false,
      androidVersion: " 17 ",
      appVersion: " 1.0.0 ",
      maplibreVersion: " 10.4.2 ",
    });
    await caller.account.submitFeedback({ message: `${prefix}-contact`, includeEmail: true });
    const records = await prisma.feedback.findMany({ where: { message: { startsWith: prefix } } });
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.message === `${prefix}-private`)).toMatchObject({
      email: null,
      androidVersion: "17",
      appVersion: "1.0.0",
      maplibreVersion: "10.4.2",
      serverVersion: "0.1.1",
    });
    expect(records.find((record) => record.message === `${prefix}-contact`)).toMatchObject({
      email: `${prefix}@example.test`,
      androidVersion: null,
      appVersion: null,
      maplibreVersion: null,
      serverVersion: "0.1.1",
    });
  });
});
