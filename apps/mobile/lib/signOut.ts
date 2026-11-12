import { deviceUnverifiedCause, tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import * as SecureStore from "expo-secure-store";
import { trpcClient } from "./api.ts";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "./auth-client.ts";
import { cancelDeviceKeyRegistrations, getRegisteredDeviceKey } from "./deviceKeys.ts";
import { clearPendingJoinCodes } from "./pendingJoinCode.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";
import {
  abandonLocationSharingChanges,
  clearPendingSharingChanges,
  getPendingSharingChanges,
  syncLocationSharing,
} from "./locationSharing.ts";
import { readRegisteredDevice } from "./registeredDevice.ts";
import { linkSessionToDevice } from "./sessionLink.ts";
import { requestTrackingSync } from "./trackingEvents.ts";

const removeThisDevice = async () =>
  (
    await tryCatch(
      trpcClient.account.removeThisDevice.mutate(undefined, {
        context: { handleDeviceErrors: false },
      }),
    )
  ).error;

const linkAndRemoveThisDevice = async () => {
  const error = await removeThisDevice();
  if (!(error instanceof TRPCClientError && error.data?.cause === deviceUnverifiedCause))
    return error;
  const device = await getRegisteredDeviceKey();
  if (!device) return error;
  const linked = await tryCatch(linkSessionToDevice(device));
  if (linked.error) return linked.error;
  return removeThisDevice();
};

export const signOutOfThisPhone = async ({
  onSigningOut,
  removeThisPhone,
  sessionTokenToRevoke,
}: {
  onSigningOut: () => void;
  removeThisPhone: boolean;
  sessionTokenToRevoke: string | null;
}): Promise<{ status: "phoneRemoved" | "signedOut" | "serverUnreachable" }> => {
  const tracking = await import("./tracking.ts");
  await Promise.race([
    tryCatch(syncLocationSharing()),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  abandonLocationSharingChanges();
  await tryCatch(tracking.prepareTrackingSignOut());
  onSigningOut();
  if (removeThisPhone) {
    const error = await linkAndRemoveThisDevice();
    const deviceRemoved = await import("./deviceRemoved.ts");
    if (!error || isDeviceRemovedError(error) || deviceRemoved.isWipingThisPhone()) {
      await deviceRemoved.wipeAfterRemovingThisPhone();
      return { status: "phoneRemoved" };
    }
    if (!(error instanceof TRPCClientError && error.data) || error.data.httpStatus >= 500) {
      tracking.resumeTracking();
      requestTrackingSync();
      return { status: "serverUnreachable" };
    }
    if (error.data.code === "UNAUTHORIZED" && !(await readRegisteredDevice())) {
      return { status: "phoneRemoved" };
    }
  }
  const device = await getRegisteredDeviceKey();
  const pending = device ? getPendingSharingChanges(device.userId) : null;
  const heldBack =
    device && (pending?.account?.paused || pending?.device?.paused)
      ? await tryCatch(tracking.deleteQueuedTrackingPoints(device))
      : null;
  if (!heldBack?.error) clearPendingSharingChanges();
  const signedOut = await tryCatch(authClient.signOut());
  if ((signedOut.error || signedOut.data.error) && sessionTokenToRevoke) {
    await tryCatch(SecureStore.setItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, sessionTokenToRevoke));
  }
  cancelDeviceKeyRegistrations();
  clearPendingJoinCodes();
  return { status: "signedOut" };
};
