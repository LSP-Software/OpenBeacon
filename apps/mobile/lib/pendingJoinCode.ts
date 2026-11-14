import { router } from "expo-router";
import { readThisDeviceState } from "./deviceActivation.ts";
import { readRegisteredDeviceNow } from "./registeredDevice.ts";
import { storage } from "./storage.ts";

const STORAGE_PREFIX = "pendingJoinCode.";
const JOIN_CODE = /^[A-Fa-f0-9]{32}$/;

export const clearPendingJoinCodes = () => {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(STORAGE_PREFIX)) storage.remove(key);
  }
};

export const savePendingJoinCode = ({ code, userId }: { code: string; userId: string }) => {
  clearPendingJoinCodes();
  storage.set(`${STORAGE_PREFIX}${userId}`, `${Date.now()}:${code}`);
};

export const takePendingJoinCode = (userId: string) => {
  const stored = storage.getString(`${STORAGE_PREFIX}${userId}`);
  clearPendingJoinCodes();
  if (!stored) return null;
  const separator = stored.indexOf(":");
  const age = Date.now() - Number(stored.slice(0, separator));
  const code = stored.slice(separator + 1);
  return separator > 0 && age >= 0 && age < 24 * 60 * 60 * 1000 && code ? code : null;
};

export const joinCodeFromLink = (link: string) => {
  const [location = "", query = ""] = link.split("#")[0]?.split("?") ?? [];
  const route = location.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
  if (route !== "join" && !route.endsWith("/join")) return null;
  const code = query
    .split("&")
    .find((pair) => pair.startsWith("code="))
    ?.slice("code=".length);
  return code && JOIN_CODE.test(code) ? code.toUpperCase() : null;
};

export const joinCodeFromInput = (input: string) => {
  const trimmed = input.trim();
  if (JOIN_CODE.test(trimmed)) return trimmed.toUpperCase();
  return joinCodeFromLink(trimmed);
};

export const saveJoinLinkForAfterSetup = (link: string) => {
  const code = joinCodeFromLink(link);
  const device = readRegisteredDeviceNow();
  if (!code || !device || readThisDeviceState() === "active") return;
  savePendingJoinCode({ code, userId: device.userId });
};

export const openAppAfterSetup = (home: "/" | "/(tabs)/map") => {
  const userId = readRegisteredDeviceNow()?.userId;
  const code = userId ? takePendingJoinCode(userId) : null;
  if (!userId) clearPendingJoinCodes();
  router.replace(code ? { pathname: "/join", params: { code } } : home);
};
