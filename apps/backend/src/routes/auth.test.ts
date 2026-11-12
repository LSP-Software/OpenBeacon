import { expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../types/AppEnv.ts";
import { testRedisHashSecret } from "@openbeacon/cache/testing";

test("logs authentication rate limits without request details", async () => {
  process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/openbeacon";
  process.env["BETTER_AUTH_SECRET"] ??= "test-secret-with-at-least-32-characters";
  process.env["REDIS_HASH_SECRET"] ??= testRedisHashSecret;
  process.env["BETTER_AUTH_URL"] ??= "http://localhost:3000";
  const { auth } = await import("@openbeacon/auth");
  const { default: router } = await import("./auth.ts");
  const handler = spyOn(auth, "handler").mockResolvedValue(new Response(null, { status: 429 }));
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  const response = await new Hono().route("/", router).request("/auth/sign-in?email=private");

  expect(response.status).toBe(429);
  expect(warning).toHaveBeenCalledWith("[rate-limit] request limited", {
    path: "auth",
    scope: "auth",
    suppressed: 0,
  });
  handler.mockRestore();
  warning.mockRestore();
});

test("passes only the server's client IP to authentication", async () => {
  process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/openbeacon";
  process.env["BETTER_AUTH_SECRET"] ??= "test-secret-with-at-least-32-characters";
  process.env["REDIS_HASH_SECRET"] ??= testRedisHashSecret;
  process.env["BETTER_AUTH_URL"] ??= "http://localhost:3000";
  const { auth, clientIpHeader } = await import("@openbeacon/auth");
  const { default: router } = await import("./auth.ts");
  const handler = spyOn(auth, "handler").mockResolvedValue(new Response(null));
  const app = new Hono<AppEnv>().route("/", router);
  const spoofed = { [clientIpHeader]: "203.0.113.9" };

  await app.request("/auth/get-session", { headers: spoofed }, { clientIp: "198.51.100.4" });
  await app.request("/auth/get-session", { headers: spoofed }, {});

  const forwarded = handler.mock.calls.map(([request]) => request.headers.get(clientIpHeader));
  expect(forwarded).toEqual(["198.51.100.4", ""]);
  handler.mockRestore();
});
