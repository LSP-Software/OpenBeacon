import { appRouter, createTRPCContext } from "@openbeacon/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { env } from "../env.ts";
import type { AppEnv } from "../types/AppEnv.ts";
import { serverVersion } from "../version.ts";

const router = new Hono<AppEnv>();

router.on(["POST", "GET"], "/trpc/*", (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    onError: ({ error, path }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        const location = [error.cause?.stack, error.stack]
          .filter((stack) => stack !== undefined)
          .join("\n")
          .split("\n")
          .map((line) => line.match(/(?:apps|packages)\/[\w./-]+\.ts:\d+:\d+/)?.[0])
          .find((line) => line !== undefined);
        console.error("[trpc] internal server error", { path, location });
      }
    },
    createContext: () =>
      createTRPCContext({
        cache: c.env.cache,
        db: c.env.db,
        headers: c.req.raw.headers,
        serverVersion,
        serverName: env.SERVER_NAME,
        ...(c.env.clientIp != null ? { clientIp: c.env.clientIp } : {}),
      }),
  });
});

export default router;
