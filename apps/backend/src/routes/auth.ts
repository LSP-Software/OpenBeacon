import { auth } from "@openbeacon/auth";
import { logRateLimit } from "@openbeacon/shared";
import { Hono } from "hono";
import type { AppEnv } from "../types/AppEnv.ts";

const router = new Hono<AppEnv>();

router.get("/auth/google-deletion-callback", (c) => {
  const params = new URLSearchParams();
  for (const key of ["code", "state", "error"]) {
    const value = c.req.query(key);
    if (value) params.set(key, value);
  }
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect(`openbeacon://google-deletion?${params.toString()}`);
});

router.on(["POST", "GET"], "/auth/*", async (c) => {
  const response = await auth.handler(c.req.raw);
  if (response.status === 429) logRateLimit({ path: "auth", scope: "auth" });
  return response;
});

export default router;
