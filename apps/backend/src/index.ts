import { Hono } from "hono";
import { env } from "./env.ts";
import { verifyB2Connectivity } from "./helpers/b2.ts";
import type { AuthType } from "./helpers/betterAuth.ts";
import authRouter from "./routes/auth.ts";
import profilePictureRouter from "./routes/profile-picture.ts";

verifyB2Connectivity().catch(() => {
  process.exit(1);
});

const app = new Hono<{ Variables: AuthType }>();

const routes = [authRouter, profilePictureRouter] as const;

routes.forEach((route) => {
  app.basePath("/api").route("/", route);
});

export default {
  fetch: app.fetch,
  port: env.OPENBEACON_API_PORT,
  hostname: env.OPENBEACON_API_HOSTNAME,
};
