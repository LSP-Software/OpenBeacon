import { expoClient } from "@better-auth/expo/client";
import { tryCatch } from "@openbeacon/shared";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { apiCompatibilityFetch } from "./apiCompatibility.ts";
import { baseUrl } from "./base-url.ts";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";

export const SESSION_TOKEN_TO_REVOKE_KEY = "sessionTokenToRevokeOnNextLogin";

export const authClient = createAuthClient({
  baseURL: baseUrl,
  fetchOptions: {
    timeout: 30_000,
    // better-fetch throws on timeouts and network failures instead of returning `{ error }`,
    // and skips its own timeout whenever a signal is passed, so the limit is enforced here.
    // This default signal never aborts; it stops better-fetch timing out on a signal of its own,
    // so an aborted signal below always means the caller cancelled.
    signal: new AbortController().signal,
    customFetchImpl: async (input, init) => {
      const timeout =
        init && "timeout" in init && typeof init.timeout === "number" ? init.timeout : 30_000;
      const callerSignal = init?.signal;
      const controller = new AbortController();
      const abort = () => controller.abort();
      callerSignal?.addEventListener("abort", abort);
      if (callerSignal?.aborted) abort();
      const timer = setTimeout(abort, timeout);
      const response = await tryCatch(
        apiCompatibilityFetch(input, { ...init, signal: controller.signal }),
      );
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abort);
      if (!response.error) return response.data;
      if (callerSignal?.aborted) throw response.error;
      return new Response(
        JSON.stringify({
          code: "SERVER_UNREACHABLE",
          message: SERVER_UNREACHABLE_MESSAGE,
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    },
  },
  plugins: [
    expoClient({
      scheme: "openbeacon",
      storagePrefix: "openbeacon",
      storage: SecureStore,
    }),
  ],
});
