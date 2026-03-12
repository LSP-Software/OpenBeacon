import { type AuthType, auth } from "@openbeacon/auth";
import { Hono } from "hono";

const router = new Hono<{ Variables: AuthType }>();

router.on(["POST", "GET"], "/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

export default router;
