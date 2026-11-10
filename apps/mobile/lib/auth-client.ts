import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { apiCompatibilityFetch } from "./apiCompatibility.ts";
import { baseUrl } from "./base-url.ts";

export const SESSION_TOKEN_TO_REVOKE_KEY = "sessionTokenToRevokeOnNextLogin";

export const authClient = createAuthClient({
  baseURL: baseUrl,
  fetchOptions: { customFetchImpl: apiCompatibilityFetch },
  plugins: [
    expoClient({
      scheme: "openbeacon",
      storagePrefix: "openbeacon",
      storage: SecureStore,
    }),
  ],
});
