import { storage } from "./storage.ts";

const KEY = "custom_server_url";

export function getServerUrl(): string {
  return storage.getString(KEY) ?? "";
}

export function setServerUrl(url: string): void {
  if (!url) {
    storage.remove(KEY);
    return;
  }
  storage.set(KEY, url);
}

export function hasCustomServerUrl(): boolean {
  return storage.contains(KEY);
}
