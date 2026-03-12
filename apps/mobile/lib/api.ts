import * as SecureStore from "expo-secure-store";
import { getServerUrl } from "./server-url.ts";

const COOKIE_STORE_KEY = "openbeacon_cookie";

function getBaseURL(): string {
  // biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket notation for index signatures
  const devUrl = process.env["EXPO_PUBLIC_DEV_API_URL"];
  if (devUrl) return devUrl;
  return getServerUrl() || "https://api.openbeacon.app";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const raw = await SecureStore.getItemAsync(COOKIE_STORE_KEY);
  if (!raw) return {};
  let parsed: Record<string, { value: string; expires: string | null }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const cookie = Object.entries(parsed)
    .filter(([, v]) => !v.expires || new Date(v.expires) > new Date())
    .map(([k, v]) => `${k}=${v.value}`)
    .join("; ");
  if (!cookie) return {};
  return { Cookie: cookie };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${getBaseURL()}${path}`;
  const authHeaders = await getAuthHeaders();

  //console.log("URL:", url);

  const headers: Record<string, string> = {
    ...authHeaders,
    Accept: "application/json",
  };

  const init: RequestInit = { method, headers };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);

  //console.log("Response:", response);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const json = (await response.json()) as { message?: string };
      if (json.message) message = json.message;
    } catch {}
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("POST", path, body);
}
