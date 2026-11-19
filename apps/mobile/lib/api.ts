import type { AppRouter } from "@openbeacon/api";
import { focusManager, QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchLink,
  loggerLink,
  type TRPCLink,
  TRPCClientError,
} from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { devicePendingCause, deviceIdHeader, deviceUnverifiedCause } from "@openbeacon/shared";
import { observable } from "@trpc/server/observable";
import { AppState } from "react-native";
import superjson from "superjson";
import {
  apiCompatibilityFetch,
  getApiCompatibility,
  withApiCompatibilityHeader,
} from "./apiCompatibility.ts";
import { authClient } from "./auth-client.ts";
import { getBaseUrl, getFeedbackUrl } from "./currentServer.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";
import { readRegisteredDevice } from "./registeredDevice.ts";
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
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (failureCount >= 3 || getApiCompatibility()) return false;
        if (!(error instanceof TRPCClientError)) return true;
        if (error.cause instanceof RequestTimeoutError) return false;
        const response = error.meta?.["response"];
        const status =
          error.data?.httpStatus ?? (response instanceof Response ? response.status : undefined);
        return typeof status !== "number" || status >= 500;
      },
    },
  },
});

const deviceRemovedLink: TRPCLink<AppRouter> =
  () =>
  ({ op, next }) =>
    observable((observer) =>
      next(op).subscribe({
        next: (value) => observer.next(value),
        complete: () => observer.complete(),
        error: (error) => {
          if (op.context["handleDeviceErrors"] === false) {
            observer.error(error);
            return;
          }
          if (isDeviceRemovedError(error)) {
            void import("./deviceRemoved.ts").then(({ handleDeviceRemoved }) =>
              handleDeviceRemoved(),
            );
          }
          if (error.data?.cause === devicePendingCause) {
            void import("./deviceActivation.ts").then(({ handleDevicePending }) =>
              handleDevicePending(),
            );
          }
          if (error.data?.cause === deviceUnverifiedCause) {
            void import("./sessionLink.ts").then(({ handleDeviceUnverified }) =>
              handleDeviceUnverified(),
            );
          }
          observer.error(error);
        },
      }),
    );

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    deviceRemovedLink,
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
      url: "/api/trpc",
      maxURLLength: 6000,
      maxItems: 20,
      fetch: (path, options) =>
        apiCompatibilityFetch(`${getBaseUrl()}${path}`, {
          ...options,
          signal: options?.signal ?? null,
        }),
      async headers() {
        const headers = new Map<string, string>();
        headers.set("x-trpc-source", "expo-react");

        const cookies = await authClient.getCookie();
        if (cookies) {
          headers.set("Cookie", cookies);
        }
        const device = await readRegisteredDevice();
        if (device) {
          headers.set(deviceIdHeader, device.deviceId);
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
      maxItems: 20,
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

for (const queryKey of [
  trpc.accountRecovery.status.queryKey(),
  trpc.account.listDevices.queryKey(),
  trpc.device.status.queryKey(),
  trpc.deviceLink.status.queryKey(),
]) {
  queryClient.setQueryDefaults(queryKey, { staleTime: 0 });
}

export type { RouterInputs, RouterOutputs } from "@openbeacon/api";
