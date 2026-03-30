import type { AppRouter } from "@openbeacon/api";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";
import { authClient } from "./auth-client.ts";
import { getBaseUrl } from "./base-url.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ...
    },
  },
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    loggerLink({
      enabled: (opts) =>
        process.env.NODE_ENV === "development" ||
        (opts.direction === "down" && opts.result instanceof Error),
      colorMode: "ansi",
    }),
    httpBatchLink({
      transformer: superjson,
      url: `${getBaseUrl()}/api/trpc`,
      headers() {
        const headers = new Map<string, string>();
        headers.set("x-trpc-source", "expo-react");

        const cookies = authClient.getCookie();
        if (cookies) {
          headers.set("Cookie", cookies);
        }
        return headers;
      },
    }),
  ],
});

/**
 * A set of typesafe hooks for consuming your API.
 */
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});

export type { RouterInputs, RouterOutputs } from "@openbeacon/api";
