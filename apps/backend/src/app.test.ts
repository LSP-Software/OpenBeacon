import { describe, expect, test } from "bun:test";
import { apiCompatibilityLevel, minClientApiCompatibilityLevel } from "@openbeacon/shared";
import { testRedisHashSecret } from "@openbeacon/cache/testing";

Object.assign(process.env, {
  DATABASE_URL: "postgresql://localhost:5432/openbeacon",
  REDIS_URL: "redis://localhost:6379",
  REDIS_HASH_SECRET: testRedisHashSecret,
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  IMAGES_S3_ENDPOINT: "https://images-storage.example.com",
  IMAGES_S3_REGION: "us-east-1",
  IMAGES_S3_CDN_URL: "https://cdn.example.com/file",
  IMAGES_S3_ACCESS_KEY_ID: "12345678901234567890",
  IMAGES_S3_ACCESS_KEY: "12345678901234567890",
  IMAGES_S3_BUCKET_NAME: "test-bucket",
  MAP_S3_ENDPOINT: "https://map-storage.example.com",
  MAP_S3_REGION: "us-east-1",
  MAP_S3_ACCESS_KEY_ID: "test-access-key-id",
  MAP_S3_ACCESS_KEY: "test-secret-access-key",
  MAP_S3_BUCKET_NAME: "test-bucket",
});
const { app } = await import("./app.ts");
const { refreshAnnouncements } = await import("./announcements.ts");

const expectLevelHeaders = (response: Response) => {
  expect(response.headers.get("x-openbeacon-api-compatibility-level")).toBe(
    String(apiCompatibilityLevel),
  );
  expect(response.headers.get("x-openbeacon-min-client-api-compatibility-level")).toBe(
    String(minClientApiCompatibilityLevel),
  );
};

describe("app", () => {
  test.each(["/api/trpc/account.version", "/api/auth/get-session"])(
    "turns away %s from an app that sends no level, leaving out the optional message when unset",
    async (path) => {
      const response = await app.request(path);
      expect(response.status).toBe(426);
      expect(await response.json()).toEqual({
        code: "CLIENT_TOO_OLD",
        minClientApiCompatibilityLevel,
      });
      expectLevelHeaders(response);
    },
  );

  test("answers a call to a procedure this server doesn't have with the frozen 404 body", async () => {
    const response = await app.request("/api/trpc/places.fromTheFuture", {
      headers: { "x-openbeacon-api-compatibility-level": String(apiCompatibilityLevel) },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "UNKNOWN_PROCEDURE",
      apiCompatibilityLevel,
    });
    expectLevelHeaders(response);
  });

  test("keeps /health open with its frozen keys, leaving out the optional message when unset", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    const body: Record<string, unknown> = await response.json();
    expect(body["apiCompatibilityLevel"]).toBe(apiCompatibilityLevel);
    expect(body["minClientApiCompatibilityLevel"]).toBe(minClientApiCompatibilityLevel);
    expect(Object.keys(body).sort()).toEqual(
      [
        "status",
        "version",
        "serverName",
        "apiCompatibilityLevel",
        "minClientApiCompatibilityLevel",
      ].sort(),
    );
  });

  test("adds the frozen announcements key to /health while one is showing", async () => {
    await refreshAnnouncements({
      announcement: {
        findMany: async () => [
          {
            id: "0196a1b2-0000-7000-8000-000000000001",
            message: "We're moving servers tonight.",
            severity: "WARNING",
            platform: "IOS",
            minAppVersion: "1.0.0",
            maxAppVersion: "2.0.0",
            downtimeStartsAt: new Date("2999-01-01T00:00:00.000Z"),
            downtimeEndsAt: new Date("2999-01-01T01:00:00.000Z"),
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date("2999-01-01T01:00:00.000Z"),
            createdAt: new Date(),
          },
        ],
      },
    });
    const body: Record<string, unknown> = await (await app.request("/health")).json();
    expect(body["announcements"]).toEqual([
      {
        id: "0196a1b2-0000-7000-8000-000000000001",
        message: "We're moving servers tonight.",
        severity: "warning",
        platform: "ios",
        minAppVersion: "1.0.0",
        maxAppVersion: "2.0.0",
        downtimeStartsAt: "2999-01-01T00:00:00.000Z",
        downtimeEndsAt: "2999-01-01T01:00:00.000Z",
        endsAt: "2999-01-01T01:00:00.000Z",
      },
    ]);
    await refreshAnnouncements({ announcement: { findMany: async () => [] } });
  });

  test("sends a browser back to the app from the Google deletion callback", async () => {
    const response = await app.request("/api/auth/google-deletion-callback?code=abc&state=xyz");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "openbeacon://google-deletion?code=abc&state=xyz",
    );
    expectLevelHeaders(response);
  });
});
