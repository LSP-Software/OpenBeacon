import { describe, expect, test } from "bun:test";
import { serverVersion } from "../version.ts";

describe("health endpoint", () => {
  test("returns the configured server name and release version", async () => {
    process.env["DATABASE_URL"] = "postgresql://localhost:5432/openbeacon";
    process.env["REDIS_URL"] = "redis://localhost:6379";
    process.env["BETTER_AUTH_SECRET"] = "test-secret-with-at-least-32-characters";
    process.env["BETTER_AUTH_URL"] = "http://localhost:3000";
    process.env["SERVER_NAME"] = "Family server";
    const { default: health } = await import("./health.ts");
    const response = await health.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      version: serverVersion,
      serverName: "Family server",
    });
  });
});
