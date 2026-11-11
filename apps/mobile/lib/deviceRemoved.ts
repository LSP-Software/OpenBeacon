import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import { queryClient, trpc } from "./api.ts";
import { authClient } from "./auth-client.ts";
import { cancelDeviceKeyRegistrations, deleteDeviceKey } from "./deviceKeys.ts";
import { clearGroupColors } from "./groupColor.ts";
import { deleteStoredHistoryKeys } from "./historyKeys.ts";
import { readRegisteredDevice } from "./registeredDevice.ts";
import { clearTrackingKeyCheck } from "./trackingKeyCheck.ts";
import { clearTrackingUploadTimes } from "./trackingUploadTime.ts";

export const wipeThisPhone = async () => {
  const device = await readRegisteredDevice();
  cancelDeviceKeyRegistrations();
  await queryClient.cancelQueries();
  const currentHistoryKeyVersion =
    queryClient.getQueryData(trpc.accountRecovery.status.queryKey())?.currentHistoryKey?.version ??
    0;
  const tracking = await import("./tracking.ts");
  await tryCatch(tracking.revokeTrackingAccess());
  if (device) {
    await tryCatch(tracking.deleteQueuedTrackingPoints(device));
    await tryCatch(
      deleteStoredHistoryKeys({
        userId: device.userId,
        upToVersion: Math.max(currentHistoryKeyVersion, 100),
      }),
    );
    await tryCatch(deleteDeviceKey(device.userId));
  }
  queryClient.clear();
  clearGroupColors();
  clearTrackingUploadTimes();
  clearTrackingKeyCheck();
  await tryCatch(authClient.signOut());
};

let removal: Promise<void> | null = null;

export const handleDeviceRemoved = () => {
  removal ??= (async () => {
    await wipeThisPhone();
    await tryCatch(Promise.resolve().then(() => router.replace("/device-removed")));
  })().finally(() => {
    removal = null;
  });
  return removal;
};
