import { Hono } from "hono";
import { type AuthType, auth } from "../helpers/betterAuth";

const router = new Hono<{ Bindings: AuthType }>({
  strict: false,
});

router.on(["POST", "GET"], "/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

export default router;
