import { tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import * as SecureStore from "expo-secure-store";
import { trpcClient } from "./api.ts";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "./auth-client.ts";
import { cancelDeviceKeyRegistrations } from "./deviceKeys.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";

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
  await tryCatch(tracking.prepareTrackingSignOut());
  onSigningOut();
  if (removeThisPhone) {
    const removed = await tryCatch(trpcClient.account.removeThisDevice.mutate());
    if (!removed.error || isDeviceRemovedError(removed.error)) {
      const { wipeAfterRemovingThisPhone } = await import("./deviceRemoved.ts");
      await wipeAfterRemovingThisPhone();
      return { status: "phoneRemoved" };
    }
    if (!(removed.error instanceof TRPCClientError && removed.error.data)) {
      tracking.resumeTracking();
      return { status: "serverUnreachable" };
    }
  }
  const signedOut = await tryCatch(authClient.signOut());
  if ((signedOut.error || signedOut.data.error) && sessionTokenToRevoke) {
    await tryCatch(SecureStore.setItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, sessionTokenToRevoke));
  }
  cancelDeviceKeyRegistrations();
  return { status: "signedOut" };
};
