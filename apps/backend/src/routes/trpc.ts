import { appRouter, createTRPCContext } from "@openbeacon/api";
import type { AuthType } from "@openbeacon/auth";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";

const router = new Hono<{ Variables: AuthType }>();

router.on(["POST", "GET"], "/trpc/*", (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () =>
      createTRPCContext({
        headers: c.req.raw.headers,
      }),
  });
});

export default router;
