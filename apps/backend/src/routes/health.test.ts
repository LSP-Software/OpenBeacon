import { describe, expect, test } from "bun:test";
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

  test("readiness pings Redis while health stays independent of it", async () => {
    const { default: health } = await import("./health.ts");
    const unreachable = { cache: { ping: async () => false } };
    expect((await health.request("/health", {}, unreachable)).status).toBe(200);
    const notReady = await health.request("/ready", {}, unreachable);
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ status: "unavailable", redis: "unreachable" });
    const ready = await health.request("/ready", {}, { cache: { ping: async () => true } });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
  });
});
