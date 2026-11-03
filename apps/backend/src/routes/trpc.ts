import { appRouter, createTRPCContext } from "@openbeacon/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import type { AppEnv } from "../types/AppEnv.ts";
import { serverVersion } from "../version.ts";

const router = new Hono<AppEnv>();

router.on(["POST", "GET"], "/trpc/*", (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () =>
      createTRPCContext({
        cache: c.env.cache,
        db: c.env.db,
        headers: c.req.raw.headers,
        serverVersion,
        ...(c.env.clientIp != null ? { clientIp: c.env.clientIp } : {}),
      }),
  });
});

export default router;
