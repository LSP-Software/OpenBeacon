import { baseUrl } from "./base-url.ts";
import { storage } from "./storage.ts";

export const REGISTERED_DEVICE_KEY = "encryption.device.registered";

const parseStoredRecord = (stored: string): unknown => {
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

export const readRegisteredDeviceNow = () => {
  const stored = storage.getString(REGISTERED_DEVICE_KEY);
  if (!stored) return null;
  const record = parseStoredRecord(stored);
  if (!Array.isArray(record) || record[0] !== baseUrl) return null;
  const [, userId, deviceId, publicKey] = record;
  if (typeof userId !== "string" || typeof deviceId !== "string" || typeof publicKey !== "string")
    return null;
  return { userId, deviceId, publicKey };
};

export const readRegisteredDevice = async () => readRegisteredDeviceNow();
