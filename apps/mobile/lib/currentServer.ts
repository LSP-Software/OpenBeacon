import { storage } from "./storage.ts";

const SERVER_URL_KEY = "custom_server_url";
const hostedApiUrl = "https://api.openbeacon.net";

export const normaliseServerUrl = (
  input: string,
): { url: string; error: null } | { url: null; error: string } => {
  const trimmed = input.trim();
  if (trimmed.length > 200) return { url: null, error: "That address is too long" };
  const parsed = URL.canParse(trimmed) ? new URL(trimmed) : null;
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.host) {
    return {
      url: null,
      error: __DEV__
        ? "Enter a URL that starts with http:// or https://"
        : "Enter a URL that starts with https://",
    };
  }
  if (!__DEV__ && parsed.protocol === "http:") {
    return {
      url: null,
      error: "Use an https:// address. The app only connects to servers over HTTPS.",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      url: null,
      error: "Remove the username and password from the URL",
    };
  }
  if (parsed.search || parsed.hash || /[?#]/.test(trimmed)) {
    return { url: null, error: "Remove everything from the ? or # onwards" };
  }
  const plainHost = /^([a-z0-9._-]+|\[[0-9a-f:.]+\])(:\d*)?$/i;
  const typedHost = /^[a-z][a-z0-9+.-]*:[\\/]*([^\\/?#]*)/i.exec(trimmed)?.[1] ?? "";
  if (!plainHost.test(typedHost) || !plainHost.test(parsed.host)) {
    return {
      url: null,
      error:
        "Use the address in plain letters, numbers, dots and hyphens. For a domain with accents or other alphabets, use its xn-- form.",
    };
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const url = `${parsed.origin}${path}`;
  return url.length > 200 ? { url: null, error: "That address is too long" } : { url, error: null };
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

export const isHostedServer = (url: string) => url === hostedApiUrl;

export const hasCustomServerUrl = () => getServerUrl() !== "";

const getDevelopmentUrl = () => {
  const developmentUrl = __DEV__ ? process.env.EXPO_PUBLIC_DEV_API_URL : undefined;
  return developmentUrl ? (normaliseServerUrl(developmentUrl).url ?? developmentUrl) : "";
};

export const getSelectedServerUrl = () => getServerUrl() || hostedApiUrl;

export const getBaseUrl = () => getDevelopmentUrl() || getSelectedServerUrl();

export const getFeedbackUrl = () => getDevelopmentUrl() || hostedApiUrl;
