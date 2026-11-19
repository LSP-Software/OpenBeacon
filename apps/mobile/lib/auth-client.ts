import { expoClient } from "@better-auth/expo/client";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { tryCatch } from "@openbeacon/shared";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { apiCompatibilityFetch } from "./apiCompatibility.ts";
import { getBaseUrl } from "./currentServer.ts";
import { parseJson } from "./parseJson.ts";
import { getSecureStoreOptions } from "./secureStoreOptions.ts";
import { withSecretDeadline } from "./secretStorage.ts";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";
import { z } from "zod";

const SESSION_TOKEN_TO_REVOKE_KEY = "sessionTokenToRevokeOnNextLogin";

export const getServerKey = (server: string) =>
  bytesToHex(sha256(utf8ToBytes(server))).slice(0, 32);

export const saveSessionTokenToRevoke = (token: string) =>
  SecureStore.setItemAsync(
    SESSION_TOKEN_TO_REVOKE_KEY,
    JSON.stringify([getBaseUrl(), token]),
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
  if (parsed.success && parsed.data[0] === getBaseUrl()) return parsed.data[1];
  await forgetSessionTokenToRevoke();
  return null;
};

const authBaseUrl = `${getBaseUrl()}/api/auth`;

const toServer = (input: RequestInfo | URL, server: string) => {
  const url = input instanceof Request ? input.url : String(input);
  return url.startsWith(authBaseUrl) ? `${server}/api/auth${url.slice(authBaseUrl.length)}` : url;
};

const boundServerHeader = "x-openbeacon-bound-server";

export const SERVER_CHANGED_CODE = "SERVER_CHANGED";

export const bindToServer = (server: string) => ({ headers: { [boundServerHeader]: server } });

const toCurrentServerKey = (key: string) =>
  key.replace(/^openbeacon_/, `openbeacon_${getServerKey(getBaseUrl())}_`);

const unreachable = () =>
  new Response(
    JSON.stringify({
      code: "SERVER_UNREACHABLE",
      message: SERVER_UNREACHABLE_MESSAGE,
    }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );

const serverChanged = () =>
  new Response(
    JSON.stringify({
      code: SERVER_CHANGED_CODE,
      message: "The server changed. Try again.",
    }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );

export const authClient = createAuthClient({
  baseURL: authBaseUrl,
  sessionOptions: { refetchOnWindowFocus: false },
  fetchOptions: {
    timeout: 30_000,
    // better-fetch throws on timeouts and network failures instead of returning `{ error }`,
    // and skips its own timeout whenever a signal is passed, so the limit is enforced here.
    // This default signal never aborts; it stops better-fetch timing out on a signal of its own,
    // so an aborted signal below always means the caller cancelled.
    signal: new AbortController().signal,
    customFetchImpl: async (input, init) => {
      const server = getBaseUrl();
      const headers = new Headers(init?.headers);
      const boundServer = headers.get(boundServerHeader);
      if (boundServer !== null && boundServer !== server) return serverChanged();
      headers.delete(boundServerHeader);
      const timeout =
        init && "timeout" in init && typeof init.timeout === "number" ? init.timeout : 30_000;
      const callerSignal = init?.signal;
      const controller = new AbortController();
      const abort = () => controller.abort();
      callerSignal?.addEventListener("abort", abort);
      if (callerSignal?.aborted) abort();
      const timer = setTimeout(abort, timeout);
      const response = await tryCatch(
        apiCompatibilityFetch(toServer(input, server), {
          ...init,
          headers,
          signal: controller.signal,
        }).then(async (received) => {
          const body = await received.text();
          if (received.ok && body) {
            const parsed = await tryCatch(Promise.resolve().then(() => JSON.parse(body)));
            if (parsed.error) return unreachable();
          }
          return new Response(body || null, {
            status: received.status,
            statusText: received.statusText,
            headers: received.headers,
          });
        }),
      );
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abort);
      if (!response.error) return response.data;
      if (callerSignal?.aborted) throw response.error;
      return unreachable();
    },
  },
  plugins: [
    inferAdditionalFields({
      user: {
        imageKeySealed: { type: "string", required: false, input: false },
      },
    }),
    expoClient({
      scheme: "openbeacon",
      storagePrefix: "openbeacon",
      storage: {
        getItem: (key) => SecureStore.getItem(toCurrentServerKey(key), getSecureStoreOptions()),
        getItemAsync: (key) =>
          withSecretDeadline(
            SecureStore.getItemAsync(toCurrentServerKey(key), getSecureStoreOptions()),
          ),
        setItem: (key, value) =>
          SecureStore.setItem(toCurrentServerKey(key), value, getSecureStoreOptions()),
        setItemAsync: (key, value) =>
          withSecretDeadline(
            SecureStore.setItemAsync(toCurrentServerKey(key), value, getSecureStoreOptions()),
          ),
      },
    }),
  ],
});
