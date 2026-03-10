import { storage } from "./storage.ts";

const KEY = "custom_server_url";

export function getServerUrl(): string {
  return storage.getString(KEY) ?? "";
}

export function setServerUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed) {
    storage.set(KEY, trimmed);
  } else {
    storage.remove(KEY);
  }
}

export function hasCustomServerUrl(): boolean {
  return storage.contains(KEY);
}
