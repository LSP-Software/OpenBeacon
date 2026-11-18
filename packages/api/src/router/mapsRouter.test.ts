import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis, testRedisHashSecret } from "@openbeacon/cache/testing";

const testEnv = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-000000000000000000000000",
  DATABASE_URL: "postgresql://localhost:5432/openbeacon",
  NODE_ENV: "production",
  IMAGES_S3_ENDPOINT: "https://images-storage.example.com",
  IMAGES_S3_REGION: "us-east-1",
  IMAGES_S3_ACCESS_KEY_ID: "test-images-access-key-id",
  IMAGES_S3_ACCESS_KEY: "test-images-secret-access-key",
  IMAGES_S3_BUCKET_NAME: "test-images-bucket",
  IMAGES_S3_CDN_URL: "https://cdn.example.com/file",
  MAP_S3_ENDPOINT: "https://map-storage.example.com",
  MAP_S3_REGION: "us-east-1",
  MAP_S3_ACCESS_KEY_ID: "test-storage-access-key-id",
  MAP_S3_ACCESS_KEY: "test-storage-secret-access-key",
  MAP_S3_BUCKET_NAME: "test-storage-bucket",
};

describe("mapsRouter", () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const [key, value] of Object.entries(testEnv)) {
      original.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const [key, value] of original) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("configures the force refresh route with a strict ten minute rate limit", async () => {
    const cacheBuster = `test=${Math.random().toString(36).slice(2)}`;
    const { mapsRouter }: typeof import("./mapsRouter.ts") = await import(
      `./mapsRouter.ts?${cacheBuster}`
    );

    expect(mapsRouter.forceRefreshSignedPmtilesUrl._def.meta).toEqual({
      rateLimit: {
        limit: 3,
        windowMs: 600_000,
      },
    });
  });

  test("map URL calls leave no account ID in the server log", async () => {
    const signedUrl = {
      archiveId: "archive-1",
      expiresAt: "2026-11-18T00:10:00.000Z",
      key: "maps/a.pmtiles",
      mapBuild: "20261118",
      mapSlot: "a",
      refreshAt: "2026-11-18T00:05:00.000Z",
      source: "generated",
      url: "https://map-storage.example.com/a.pmtiles",
    };
    mock.module("../lib/pmtilesUrl.ts", () => ({
      getSignedPmtilesUrlForUser: async () => signedUrl,
      forceRefreshSignedPmtilesUrlForUser: async () => ({ ...signedUrl, source: "forced" }),
    }));
    const { mapsRouter }: typeof import("./mapsRouter.ts") = await import(
      `./mapsRouter.ts?test=${Math.random().toString(36).slice(2)}`
    );
    const { createTRPCRouter } = await import("../trpcRuntime.ts");
    const caller = createTRPCRouter({ maps: mapsRouter }).createCaller({
      cache: new (class extends OpenBeaconCache {
        protected override createRedisClient(): FakeRedis {
          return new FakeRedis();
        }
      })({ redisUrl: "redis://localhost:6379", hashSecret: testRedisHashSecret, now: () => 0 }),
      deviceId: "device-1",
      deviceActive: true,
      session: { user: { id: "account-7f3a" } },
    } as never);
    const logged: unknown[][] = [];
    const spies = (["info", "log", "warn", "error"] as const).map((level) =>
      spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      }),
    );

    await caller.maps.getSignedPmtilesUrl();
    await caller.maps.forceRefreshSignedPmtilesUrl();

    for (const spy of spies) spy.mockRestore();
    mock.restore();
    expect(JSON.stringify(logged)).not.toContain("account-7f3a");
  });
});
