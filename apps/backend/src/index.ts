import "./validateEnv.ts";
import "./validateServices.ts";
import { securityAlerts } from "@openbeacon/auth";
import { Hono } from "hono";
import { cache } from "./cache.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { authenticateCloudflare, resolveClientIp } from "./helpers/clientIp.ts";
import healthRouter from "./routes/health.ts";
import authRouter from "./routes/auth.ts";
import trpcRouter from "./routes/trpc.ts";
import type { AppEnv } from "./types/AppEnv.ts";

if (securityAlerts) {
  securityAlerts.schedulePendingAlertsTurnedOff();
  setInterval(securityAlerts.schedulePendingAlertsTurnedOff, 60_000);
}

const app = new Hono<AppEnv>();

app.route("/", healthRouter);

const routes = [authRouter, trpcRouter] as const;

routes.forEach((route) => {
  app.basePath("/api").route("/", route);
});

export default {
  fetch(request: Request, server: Bun.Server<unknown>) {
    if (
      env.TRUSTED_PROXY_PROVIDER === "cloudflare-authenticated" &&
      !(request.method === "GET" && new URL(request.url).pathname === "/health") &&
      !authenticateCloudflare({
        headers: request.headers,
        secret: env.CLOUDFLARE_ORIGIN_SECRET ?? "",
      })
    ) {
      return new Response("Forbidden", { status: 403 });
    }

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
  maxRequestBodySize: 8 * 1024 * 1024,
};
