import { describe, expect, test } from "bun:test";
import { apiCompatibilityLevel } from "@openbeacon/shared";
import { Hono } from "hono";
import { testRedisHashSecret } from "@openbeacon/cache/testing";

const setEnv = () =>
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

const createApp = async () => {
  setEnv();
  const { default: trpc } = await import("./trpc.ts");
  return new Hono().basePath("/api").route("/", trpc);
};

describe("tRPC route", () => {
  test("answers a call to a procedure this server doesn't have with the frozen 404 body", async () => {
    setEnv();
    const { default: trpc } = await import("./trpc.ts");
    const app = new Hono().basePath("/api").route("/", trpc);
    const response = await app.request("/api/trpc/account.version,places.fromTheFuture?batch=1");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "UNKNOWN_PROCEDURE", apiCompatibilityLevel });
  });

  test("refuses a request that carries more calls than the app ever batches", async () => {
    const app = await createApp();
    const calls = (count: number) =>
      `/api/trpc/${Array.from({ length: count }, () => "account.version").join(",")}?batch=1`;
    const tooMany = await app.request(calls(41), {}, { cache: null, db: null });
    expect(tooMany.status).toBe(400);
    const allowed = await app.request(calls(40), {}, { cache: null, db: null });
    expect(allowed.status).not.toBe(400);
  });

  test("never sends a stack trace, even when NODE_ENV isn't production", async () => {
    const app = await createApp();
    const response = await app.request(
      "/api/trpc/maps.getSignedPmtilesUrl",
      {},
      { cache: null, db: null },
    );
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("stack");
  });
});
