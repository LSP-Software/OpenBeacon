import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "@openbeacon/database";
import { runVerificationCleanup } from "./verificationCleanup.ts";

const prefix = `verification-cleanup-${crypto.randomUUID()}`;
const rows = {
  expiredCode: { identifier: `email-code:sign-up:${prefix}@example.com`, expiresInMs: -60_000 },
  expiredToken: { identifier: `${prefix}-expired-token`, expiresInMs: -1_000 },
  expiredBetterAuth: { identifier: `${prefix}-better-auth`, expiresInMs: -3_600_000 },
  liveCode: { identifier: `email-code:password-reset:${prefix}@example.com`, expiresInMs: 600_000 },
  liveToken: { identifier: `${prefix}-live-token`, expiresInMs: 60_000 },
};

const remaining = async () =>
  (
    await prisma.verification.findMany({
      where: { id: { startsWith: prefix } },
      select: { id: true },
      orderBy: { id: "asc" },
    })
  ).map(({ id }) => id.slice(prefix.length + 1));

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("verification cleanup", () => {
  beforeEach(async () => {
    await prisma.verification.deleteMany({ where: { id: { startsWith: prefix } } });
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error("Unable to read database time.");
    await prisma.verification.createMany({
      data: Object.entries(rows).map(([name, row]) => ({
        id: `${prefix}-${name}`,
        identifier: row.identifier,
        value: "hashed",
        expiresAt: new Date(clock.now.getTime() + row.expiresInMs),
      })),
    });
  });

  afterAll(async () => {
    await prisma.verification.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  test("deletes expired code, token and better-auth rows and keeps unexpired ones", async () => {
    await runVerificationCleanup();
    expect(await remaining()).toEqual(["liveCode", "liveToken"]);
  });

  test("is safe to run again", async () => {
    await runVerificationCleanup();
    await runVerificationCleanup();
    expect(await remaining()).toEqual(["liveCode", "liveToken"]);
  });
});
