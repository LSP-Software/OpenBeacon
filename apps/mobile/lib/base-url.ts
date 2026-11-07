import { getServerUrl } from "./server-url.ts";

const hostedApiUrl = "https://api.openbeacon.net";

export const getBaseUrl = () =>
  process.env.EXPO_PUBLIC_DEV_API_URL || getServerUrl() || hostedApiUrl;

export const getFeedbackUrl = () => process.env.EXPO_PUBLIC_DEV_API_URL || hostedApiUrl;

export const baseUrl = getBaseUrl();
