import type { createTRPCComponents } from "../trpc.ts";

export const createTimingMiddleware = ({
  t,
}: {
  t: ReturnType<typeof createTRPCComponents>["t"];
}) =>
  t.middleware(async ({ next, path }) => {
    const start = Date.now();

    if (t._config.isDev) {
      const waitMs = Math.floor(Math.random() * 400) + 100;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const result = await next();

    if (t._config.isDev) {
      const end = Date.now();
      console.log(`[TRPC] ${path} took ${end - start}ms to execute`);
    }

    return result;
  });
