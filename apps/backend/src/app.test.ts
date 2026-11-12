import { describe, expect, test } from "bun:test";
import { apiCompatibilityLevel, minClientApiCompatibilityLevel } from "@openbeacon/shared";

Object.assign(process.env, {
  DATABASE_URL: "postgresql://localhost:5432/openbeacon",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  S3_ACCESS_KEY_ID: "12345678901234567890",
  S3_ACCESS_KEY: "12345678901234567890",
  S3_BUCKET_NAME: "test-bucket",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
  R2_BUCKET: "test-bucket",
});
const { app } = await import("./app.ts");

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
    "turns away %s from an app that sends no level",
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

  test("keeps /health open with its frozen keys", async () => {
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

  test("sends a browser back to the app from the Google deletion callback", async () => {
    const response = await app.request("/api/auth/google-deletion-callback?code=abc&state=xyz");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "openbeacon://google-deletion?code=abc&state=xyz",
    );
    expectLevelHeaders(response);
  });
});
