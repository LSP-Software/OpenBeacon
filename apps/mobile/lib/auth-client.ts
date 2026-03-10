import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { getServerUrl } from "./server-url.ts";

const getBaseURL = (): string => {
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
