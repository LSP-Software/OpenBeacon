import { expoClient } from "@better-auth/expo/client";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { tryCatch } from "@openbeacon/shared";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { apiCompatibilityFetch } from "./apiCompatibility.ts";
import { baseUrl } from "./currentServer.ts";
import { getSecureStoreOptions } from "./secureStoreOptions.ts";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";
import { z } from "zod";

const SESSION_TOKEN_TO_REVOKE_KEY = "sessionTokenToRevokeOnNextLogin";

export const getServerKey = (server: string) =>
  bytesToHex(sha256(utf8ToBytes(server))).slice(0, 32);

export const saveSessionTokenToRevoke = (token: string) =>
  SecureStore.setItemAsync(
    SESSION_TOKEN_TO_REVOKE_KEY,
    JSON.stringify([baseUrl, token]),
    getSecureStoreOptions(),
  );

export const forgetSessionTokenToRevoke = () =>
  SecureStore.deleteItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, getSecureStoreOptions());

export const readSessionTokenToRevoke = async () => {
  const stored = await SecureStore.getItemAsync(
    SESSION_TOKEN_TO_REVOKE_KEY,
    getSecureStoreOptions(),
  );
  if (!stored) return null;
  const parsed = z.tuple([z.string(), z.string()]).safeParse(parseJson(stored));
  if (parsed.success && parsed.data[0] === baseUrl) return parsed.data[1];
  await forgetSessionTokenToRevoke();
  return null;
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const authClient = createAuthClient({
  baseURL: `${baseUrl}/api/auth`,
  sessionOptions: { refetchOnWindowFocus: false },
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
      storagePrefix: `openbeacon_${getServerKey(baseUrl)}`,
      storage: {
        getItem: (key) => SecureStore.getItem(key, getSecureStoreOptions()),
        getItemAsync: (key) => SecureStore.getItemAsync(key, getSecureStoreOptions()),
        setItem: (key, value) => SecureStore.setItem(key, value, getSecureStoreOptions()),
        setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, getSecureStoreOptions()),
      },
    }),
  ],
});
