import { expect, spyOn, test } from "bun:test";
import { Hono } from "hono";

test("logs authentication rate limits without request details", async () => {
  process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/openbeacon";
  process.env["BETTER_AUTH_SECRET"] ??= "test-secret-with-at-least-32-characters";
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
