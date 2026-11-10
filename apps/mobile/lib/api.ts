import type { AppRouter } from "@openbeacon/api";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";
import { apiCompatibilityFetch, withApiCompatibilityHeader } from "./apiCompatibility.ts";
import { authClient } from "./auth-client.ts";
import { baseUrl, getFeedbackUrl } from "./base-url.ts";

export const queryClient = new QueryClient();

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    loggerLink({
      enabled: (opts) =>
        process.env.NODE_ENV === "development" ||
        (opts.direction === "down" && opts.result instanceof Error),
      logger: (opts) => {
        console.log(`[TRPC] ${opts.direction} ${opts.path}`);
      },
    }),
    httpBatchLink({
      transformer: superjson,
      url: `${baseUrl}/api/trpc`,
      fetch: (url, options) =>
        apiCompatibilityFetch(url, { ...options, signal: options?.signal ?? null }),
      async headers() {
        const headers = new Map<string, string>();
        headers.set("x-trpc-source", "expo-react");

        const cookies = await authClient.getCookie();
        if (cookies) {
          headers.set("Cookie", cookies);
        }
        return headers;
      },
    }),
  ],
});

export const feedbackClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      transformer: superjson,
      url: `${getFeedbackUrl()}/api/trpc`,
      headers: () => ({ "x-trpc-source": "expo-react" }),
      fetch: (url, options) =>
        fetch(
          url,
          withApiCompatibilityHeader({
            ...options,
            signal: options?.signal ?? null,
            credentials: "omit",
          }),
        ),
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});

export type { RouterInputs, RouterOutputs } from "@openbeacon/api";
