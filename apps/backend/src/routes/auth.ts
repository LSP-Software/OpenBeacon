import { Hono } from "hono";
import { type AuthType, auth } from "../helpers/betterAuth.ts";

const router = new Hono<{ Variables: AuthType }>();

router.on(["POST", "GET"], "/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

export default router;
