import { auth } from "@openbeacon/auth";
import { logRateLimit } from "@openbeacon/shared";
import { Hono } from "hono";
import type { AppEnv } from "../types/AppEnv.ts";

const router = new Hono<AppEnv>();

router.on(["POST", "GET"], "/auth/*", async (c) => {
  const response = await auth.handler(c.req.raw);
  if (response.status === 429) logRateLimit({ path: "auth", scope: "auth" });
  return response;
});

export default router;
