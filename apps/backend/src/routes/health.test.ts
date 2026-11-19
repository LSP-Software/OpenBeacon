import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "@openbeacon/database";
import { apiCompatibilityLevel, minClientApiCompatibilityLevel } from "@openbeacon/shared";
import { serverVersion } from "../version.ts";
import { testRedisHashSecret } from "@openbeacon/cache/testing";

describe("health endpoint", () => {
  test("returns the configured server name, release version and update message", async () => {
    process.env["DATABASE_URL"] = "postgresql://localhost:5432/openbeacon";
    process.env["REDIS_URL"] = "redis://localhost:6379";
    process.env["REDIS_HASH_SECRET"] = testRedisHashSecret;
    process.env["BETTER_AUTH_SECRET"] = "test-secret-with-at-least-32-characters";
    process.env["BETTER_AUTH_URL"] = "http://localhost:3000";
    process.env["SERVER_NAME"] = "Family server";
    process.env["CLIENT_UPDATE_MESSAGE"] = "  Update from the Play Store.  ";
    const { default: health } = await import("./health.ts");
    const response = await health.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      version: serverVersion,
      serverName: "Family server",
      apiCompatibilityLevel,
      minClientApiCompatibilityLevel,
      message: "Update from the Play Store.",
    });
  });

  test("adds the announcements that are showing now and leaves the key out when there are none", async () => {
    const { refreshAnnouncements } = await import("../announcements.ts");
    const { default: health } = await import("./health.ts");
    const showing = {
      id: "0196a1b2-0000-7000-8000-000000000001",
      message: "We're moving servers tonight.",
      severity: "INFO" as const,
      platform: null,
      minAppVersion: null,
      maxAppVersion: null,
      downtimeStartsAt: null,
      downtimeEndsAt: null,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date("2999-01-01T00:00:00.000Z"),
      createdAt: new Date(),
    };
    const database = (rows: (typeof showing)[]) => ({
      announcement: {
        findMany: async ({ where }: { where: { startsAt: { gt?: Date } } }) =>
          where.startsAt.gt ? [] : rows,
      },
    });

    await refreshAnnouncements(database([showing]));
    const body: Record<string, unknown> = await (await health.request("/health")).json();
    expect(body["announcements"]).toEqual([
      {
        id: showing.id,
        message: showing.message,
        severity: "info",
        platform: null,
        minAppVersion: null,
        maxAppVersion: null,
        downtimeStartsAt: null,
        downtimeEndsAt: null,
        endsAt: "2999-01-01T00:00:00.000Z",
      },
    ]);

    await refreshAnnouncements(database([]));
    expect(Object.keys(await (await health.request("/health")).json())).not.toContain(
      "announcements",
    );
  });

  test("readiness checks Redis and the database while health stays independent of both", async () => {
    const { default: health } = await import("./health.ts");
    const database = (query: () => Promise<unknown>) =>
      ({ $queryRaw: query }) as unknown as PrismaClient;
    const healthyDb = database(async () => [{ "?column?": 1 }]);
    const failingDb = database(async () => {
      throw new Error("Can't reach database server");
    });
    const silentDb = database(() => new Promise(() => {}));
    const up = { ping: async () => true };
    const down = { ping: async () => false };

    expect((await health.request("/health", {}, { cache: down, db: failingDb })).status).toBe(200);
    const ready = await health.request("/ready", {}, { cache: up, db: healthyDb });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
    const noRedis = await health.request("/ready", {}, { cache: down, db: healthyDb });
    expect(noRedis.status).toBe(503);
    expect(await noRedis.json()).toEqual({ status: "unavailable", redis: "unreachable" });
    const noDatabase = await health.request("/ready", {}, { cache: up, db: failingDb });
    expect(noDatabase.status).toBe(503);
    expect(await noDatabase.json()).toEqual({ status: "unavailable", database: "unreachable" });
    const started = performance.now();
    const wedged = await health.request("/ready", {}, { cache: up, db: silentDb });
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(wedged.status).toBe(503);
    expect(await wedged.json()).toEqual({ status: "unavailable", database: "unreachable" });
  });
});
