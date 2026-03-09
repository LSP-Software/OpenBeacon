import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const getBaseURL = () => {
  if (__DEV__) {
    const host = Constants.expoConfig?.hostUri?.split(":")[0];
    if (host) return `http://${host}:3000`;
  }
  return "https://your-production-url.com";
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [
    expoClient({
      scheme: "myaopenbeaconpp",
      storagePrefix: "openbeacon",
      storage: SecureStore,
    }),
  ],
});
