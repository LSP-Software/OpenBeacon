import { createMiddleware } from "hono/factory";
import { type AuthType, auth } from "../helpers/betterAuth.ts";

export const requireAuth = createMiddleware<{ Variables: AuthType }>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  c.set("user", session.user);
  c.set("session", session.session);

  await next();
});
