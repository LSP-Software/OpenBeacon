import { Hono } from "hono";
import { env } from "./env";
import type { AuthType } from "./helpers/betterAuth";
import authRouter from "./routes/auth";
import trpcRouter from "./routes/trpc";

const app = new Hono<{ Variables: AuthType }>();

const routes = [authRouter, trpcRouter] as const;

routes.forEach((route) => {
  app.basePath("/api").route("/", route);
});

export default {
  fetch: app.fetch,
  port: env.OPENBEACON_API_PORT,
  hostname: env.OPENBEACON_API_HOSTNAME,
};
