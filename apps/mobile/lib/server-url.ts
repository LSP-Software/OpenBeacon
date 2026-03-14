import { storage } from "./storage.ts";

const KEY = "custom_server_url";

export const getServerUrl = (): string => {
  return storage.getString(KEY) ?? "";
};

export const setServerUrl = (url: string): void => {
  const trimmed = url.trim();
  if (trimmed) {
    storage.set(KEY, trimmed);
  } else {
    storage.remove(KEY);
  }
};

export const hasCustomServerUrl = (): boolean => {
  return storage.contains(KEY);
};
