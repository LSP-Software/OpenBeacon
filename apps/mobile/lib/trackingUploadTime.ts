import { storage } from "./storage.ts";

const listeners = new Set<() => void>();
const key = (deviceId: string, groupId: string) => `tracking.upload.${deviceId}.${groupId}`;

export const getTrackingUploadTime = (deviceId: string, groupIds: readonly string[]) => {
  let latest: string | null = null;
  for (const groupId of groupIds) {
    const timestamp = storage.getString(key(deviceId, groupId));
    if (timestamp && (!latest || timestamp > latest)) latest = timestamp;
  }
  return latest;
};

export const recordTrackingUpload = (deviceId: string, groupId: string, timestamp: string) => {
  const existing = storage.getString(key(deviceId, groupId));
  if (existing && existing >= timestamp) return;
  storage.set(key(deviceId, groupId), timestamp);
  for (const listener of listeners) listener();
};

export const subscribeToTrackingUploads = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
