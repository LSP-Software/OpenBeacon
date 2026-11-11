import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import { queryClient, trpc, trpcClient } from "./api.ts";
import { authClient } from "./auth-client.ts";
import {
  deleteDeviceKey,
  forgetDeviceKeyRegistration,
  getStoredDeviceId,
  stopDeviceKeyRegistrations,
} from "./deviceKeys.ts";
import { clearGroupColors } from "./groupColor.ts";
import { deleteStoredHistoryKeys } from "./historyKeys.ts";
import { readRegisteredDevice } from "./registeredDevice.ts";
import { deleteSavedDeviceLink } from "./savedDeviceLink.ts";
import { clearTrackingKeyCheck } from "./trackingKeyCheck.ts";
import { clearTrackingUploadTimes } from "./trackingUploadTime.ts";

export const wipeThisPhone = async () => {
  const registered = await readRegisteredDevice();
  stopDeviceKeyRegistrations();
  const userId =
    registered?.userId ?? (await tryCatch(trpcClient.auth.deviceKeyContext.query())).data?.userId;
  const deviceId = registered?.deviceId ?? (userId ? getStoredDeviceId(userId) : undefined);
  await queryClient.cancelQueries();
  const currentHistoryKeyVersion =
    queryClient.getQueryData(trpc.accountRecovery.status.queryKey())?.currentHistoryKey?.version ??
    0;
  const tracking = await import("./tracking.ts");
  await tryCatch(tracking.revokeTrackingAccess({ keepDeviceRegistration: true }));
  if (userId) {
    await tryCatch(tracking.deleteQueuedTrackingPoints({ deviceId, userId }));
    await tryCatch(
      deleteStoredHistoryKeys({ userId, upToVersion: Math.max(currentHistoryKeyVersion, 100) }),
    );
    if (deviceId) await tryCatch(deleteSavedDeviceLink({ deviceId, userId }));
    await tryCatch(deleteDeviceKey(userId));
  }
  forgetDeviceKeyRegistration();
  queryClient.clear();
  clearGroupColors();
  clearTrackingUploadTimes();
  clearTrackingKeyCheck();
  await tryCatch(authClient.signOut());
};

let removal: Promise<void> | null = null;
let showRemovedScreen = true;

const wipeOnce = ({ removedHere }: { removedHere: boolean }) => {
  if (removedHere) showRemovedScreen = false;
  removal ??= (async () => {
    await wipeThisPhone();
    if (showRemovedScreen)
      await tryCatch(Promise.resolve().then(() => router.replace("/device-removed")));
  })().finally(() => {
    removal = null;
    showRemovedScreen = true;
  });
  return removal;
};

export const handleDeviceRemoved = () => wipeOnce({ removedHere: false });

export const wipeAfterRemovingThisPhone = () => wipeOnce({ removedHere: true });
