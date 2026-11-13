import { expect, test } from "bun:test";
import { testRedisHashSecret } from "@openbeacon/cache/testing";
import { Hono } from "hono";

process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/openbeacon";
process.env["BETTER_AUTH_SECRET"] ??= "test-secret-with-at-least-32-characters";
process.env["REDIS_HASH_SECRET"] ??= testRedisHashSecret;
process.env["BETTER_AUTH_URL"] = "https://beacon.example.com/openbeacon/";
process.env["NODE_ENV"] = "production";

const { default: router } = await import("./auth.ts");
const app = new Hono().basePath("/api").route("/", router);

test("answers auth requests a reverse proxy forwards from under a path", async () => {
  const response = await app.request("/api/auth/get-session");

  expect(response.status).toBe(200);
  expect(await response.json()).toBeNull();
});

test("keeps the request body when it adds the path for authentication", async () => {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", "expo-origin": "openbeacon://", cookie: "a=1" },
    body: JSON.stringify({ name: "Test", email: "invalid", password: "test-password" }),
  });

  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe("VALIDATION_ERROR");
});
