import { tryCatch } from "@openbeacon/shared";
import { baseUrl } from "./base-url.ts";
import { storage } from "./storage.ts";

export const REGISTERED_DEVICE_KEY = "encryption.device.registered";

export const readRegisteredDevice = async () => {
  const stored = storage.getString(REGISTERED_DEVICE_KEY);
  if (!stored) return null;
  const record = await tryCatch(Promise.resolve().then((): unknown => JSON.parse(stored)));
  if (!Array.isArray(record.data) || record.data[0] !== baseUrl) return null;
  const [, userId, deviceId, publicKey] = record.data;
  if (typeof userId !== "string" || typeof deviceId !== "string" || typeof publicKey !== "string")
    return null;
  return { userId, deviceId, publicKey };
};
