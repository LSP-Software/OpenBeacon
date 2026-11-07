import { getServerUrl } from "./server-url.ts";

export const getBaseUrl = () =>
  process.env.EXPO_PUBLIC_DEV_API_URL || getServerUrl() || "https://api.openbeacon.net";

export const baseUrl = getBaseUrl();
