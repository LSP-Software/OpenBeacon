import type { AppRouter } from "@openbeacon/api";
import { focusManager, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink, TRPCClientError } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { AppState } from "react-native";
import superjson from "superjson";
import { apiCompatibilityFetch, withApiCompatibilityHeader } from "./apiCompatibility.ts";
import { authClient } from "./auth-client.ts";
import { baseUrl, getFeedbackUrl } from "./base-url.ts";
import { RequestTimeoutError, timeoutLink } from "./timeoutLink.ts";

focusManager.setEventListener((handleFocus) => {
  handleFocus(AppState.currentState !== "background");
  const subscription = AppState.addEventListener("change", (state) => {
    handleFocus(state !== "background");
  });
  return () => subscription.remove();
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        failureCount < 3 &&
        !(
          error instanceof TRPCClientError &&
          (error.cause instanceof RequestTimeoutError ||
            ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(error.data?.code))
        ),
    },
  },
});

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
    timeoutLink(),
    httpBatchLink({
      transformer: superjson,
      url: `${baseUrl}/api/trpc`,
      maxURLLength: 2048,
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
    timeoutLink(),
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

for (const queryKey of [
  trpc.auth.providers.queryKey(),
  trpc.account.version.queryKey(),
  trpc.account.serverName.queryKey(),
  trpc.account.deletionVerificationMethods.queryKey(),
]) {
  queryClient.setQueryDefaults(queryKey, { staleTime: Infinity });
}

export type { RouterInputs, RouterOutputs } from "@openbeacon/api";
