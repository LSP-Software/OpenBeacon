import { storage } from "./storage.ts";

const SERVER_URL_KEY = "custom_server_url";
const hostedApiUrl = "https://api.openbeacon.net";

export const normaliseServerUrl = (
  input: string,
): { url: string; error: null } | { url: null; error: string } => {
  const trimmed = input.trim();
  const parsed = URL.canParse(trimmed) ? new URL(trimmed) : null;
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.host) {
    return { url: null, error: "Enter a URL that starts with http:// or https://" };
  }
  if (parsed.username || parsed.password) {
    return { url: null, error: "Remove the username and password from the URL" };
  }
  if (parsed.search || parsed.hash || /[?#]/.test(trimmed)) {
    return { url: null, error: "Remove everything from the ? or # onwards" };
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return { url: `${parsed.origin}${path}`, error: null };
};

export const getServerUrl = () => {
  const saved = storage.getString(SERVER_URL_KEY);
  return saved ? (normaliseServerUrl(saved).url ?? "") : "";
};

export const setServerUrl = (url: string) => {
  const normalised = url ? normaliseServerUrl(url).url : null;
  if (normalised) storage.set(SERVER_URL_KEY, normalised);
  else storage.remove(SERVER_URL_KEY);
};

export const hasCustomServerUrl = () => getServerUrl() !== "";

const getDevelopmentUrl = () => {
  const developmentUrl = process.env.EXPO_PUBLIC_DEV_API_URL;
  return developmentUrl ? (normaliseServerUrl(developmentUrl).url ?? developmentUrl) : "";
};

export const getBaseUrl = () => getDevelopmentUrl() || getServerUrl() || hostedApiUrl;

export const getFeedbackUrl = () => getDevelopmentUrl() || hostedApiUrl;

export const baseUrl = getBaseUrl();
