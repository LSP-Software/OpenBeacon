import { Hono } from "hono";
import { env } from "./env";
import type { AuthType } from "./helpers/betterAuth";
import authRouter from "./routes/auth";

const app = new Hono<{ Variables: AuthType }>({
  strict: false,
});

const routes = [authRouter] as const;

routes.forEach((route) => {
  app.basePath("/api").route("/", route);
});

export default {
  fetch: app.fetch,
  port: env.OPENBEACON_API_PORT,
  hostname: "0.0.0.0",
};
