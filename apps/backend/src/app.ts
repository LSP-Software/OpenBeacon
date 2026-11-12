import { Hono } from "hono";
import { apiCompatibility } from "./helpers/apiCompatibility.ts";
import healthRouter from "./routes/health.ts";
import authRouter from "./routes/auth.ts";
import trpcRouter from "./routes/trpc.ts";
import type { AppEnv } from "./types/AppEnv.ts";

export const app = new Hono<AppEnv>();

app.route("/", healthRouter);
app.use("/api/*", apiCompatibility);

const routes = [authRouter, trpcRouter] as const;

routes.forEach((route) => {
  app.basePath("/api").route("/", route);
});
