import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

export const authClient = createAuthClient({
  baseURL: "http://10.0.0.206:3000",
  plugins: [
    expoClient({
      scheme: "myaopenbeaconpp",
      storagePrefix: "openbeacon",
      storage: SecureStore,
    }),
  ],
});
