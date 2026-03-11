import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { getServerUrl } from "./server-url.ts";

export const SESSION_TOKEN_TO_REVOKE_KEY = "sessionTokenToRevokeOnNextLogin";

const getBaseURL = (): string => {
  // biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket notation for index signatures
  const devUrl = process.env["EXPO_PUBLIC_DEV_API_URL"];
  if (devUrl) return devUrl;
  return getServerUrl() || "https://api.openbeacon.app";
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [
    expoClient({
      scheme: "openbeacon",
      storagePrefix: "openbeacon",
      storage: SecureStore,
    }),
  ],
});
