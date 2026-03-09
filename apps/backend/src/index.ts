import { Hono } from "hono";
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
  port: 3000,
  hostname: "0.0.0.0",
};
