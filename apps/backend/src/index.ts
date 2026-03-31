import { Hono } from "hono";
import { cache } from "./cache.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import authRouter from "./routes/auth.ts";
import trpcRouter from "./routes/trpc.ts";
import type { AppEnv } from "./types/AppEnv.ts";

const app = new Hono<AppEnv>();

const routes = [authRouter, trpcRouter] as const;

routes.forEach((route) => {
  app.basePath("/api").route("/", route);
});

export default {
  fetch(request: Request, server: Bun.Server<unknown>) {
    const forwardedFor = request.headers.get("x-forwarded-for");
    const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
    const requestIp = server.requestIP(request)?.address ?? null;
    const clientIp =
      request.headers.get("cf-connecting-ip") ??
      firstForwardedIp ??
      request.headers.get("x-real-ip") ??
      requestIp;

    return app.fetch(request, { cache, clientIp, db });
  },
  port: env.OPENBEACON_API_PORT,
  hostname: env.OPENBEACON_API_HOSTNAME,
};
