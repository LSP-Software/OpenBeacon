import { useSyncExternalStore } from "react";
import { getStoredDeviceId } from "../lib/deviceKeys.ts";
import { getTrackingUploadTime, subscribeToTrackingUploads } from "../lib/trackingUploadTime.ts";

export const useTrackingUploadTime = (userId: string, groupIds: readonly string[]) => {
  return useSyncExternalStore(
    subscribeToTrackingUploads,
    () => {
      const deviceId = getStoredDeviceId(userId);
      return deviceId ? getTrackingUploadTime(deviceId, groupIds) : null;
    },
    () => null,
  );
};
