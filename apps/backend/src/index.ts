import { Hono } from "hono";
import { cache } from "./cache.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { resolveClientIp } from "./helpers/clientIp.ts";
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
    const clientIp = resolveClientIp({
      headers: request.headers,
      requestIp: server.requestIP(request)?.address ?? null,
      trustedProxyProvider: env.TRUSTED_PROXY_PROVIDER,
    });

    return app.fetch(request, {
      cache,
      db,
      ...(clientIp ? { clientIp } : {}),
    });
  },
  port: env.OPENBEACON_API_PORT,
  hostname: env.OPENBEACON_API_HOSTNAME,
};
