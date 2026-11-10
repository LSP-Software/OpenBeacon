import { describe, expect, test } from "bun:test";
import { apiCompatibilityLevel } from "@openbeacon/shared";
import { Hono } from "hono";

describe("tRPC route", () => {
  test("answers a call to a procedure this server doesn't have with the frozen 404 body", async () => {
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
      R2_PM_TILES_KEY: "pmtiles/test.pmtiles",
    });
    const { default: trpc } = await import("./trpc.ts");
    const app = new Hono().basePath("/api").route("/", trpc);
    const response = await app.request("/api/trpc/account.version,places.fromTheFuture?batch=1");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "UNKNOWN_PROCEDURE", apiCompatibilityLevel });
  });
});
