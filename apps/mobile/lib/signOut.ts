import { deviceUnverifiedCause, tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { trpcClient } from "./api.ts";
import { saveSessionTokenToRevoke } from "./auth-client.ts";
import { getRegisteredDeviceKey } from "./deviceKeys.ts";
import { endSession } from "./endSession.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";
import { abandonLocationSharingChanges, syncLocationSharing } from "./locationSharing.ts";
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
  const { signedOut } = await endSession({ reason: "signedOut" });
  if (!signedOut && sessionTokenToRevoke) {
    await tryCatch(saveSessionTokenToRevoke(sessionTokenToRevoke));
  }
  return { status: "signedOut" };
};
