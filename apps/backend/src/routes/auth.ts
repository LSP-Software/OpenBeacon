import { auth } from "@openbeacon/auth";
import { Hono } from "hono";
import type { AppEnv } from "../types/AppEnv.ts";

const router = new Hono<AppEnv>();

router.on(["POST", "GET"], "/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

export default router;
