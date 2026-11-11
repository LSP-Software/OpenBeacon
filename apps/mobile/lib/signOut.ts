import { tryCatch } from "@openbeacon/shared";
import * as SecureStore from "expo-secure-store";
import { trpcClient } from "./api.ts";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "./auth-client.ts";
import { cancelDeviceKeyRegistrations } from "./deviceKeys.ts";

export const signOutOfThisPhone = async ({
  onSigningOut,
  removeThisPhone,
  sessionTokenToRevoke,
}: {
  onSigningOut: () => void;
  removeThisPhone: boolean;
  sessionTokenToRevoke: string | null;
}) => {
  const tracking = await import("./tracking.ts");
  await tryCatch(tracking.prepareTrackingSignOut());
  onSigningOut();
  if (removeThisPhone) {
    const removed = await tryCatch(trpcClient.account.removeThisDevice.mutate());
    if (!removed.error) {
      const { wipeThisPhone } = await import("./deviceRemoved.ts");
      await wipeThisPhone();
      return { phoneRemoved: true };
    }
  }
  const signedOut = await tryCatch(authClient.signOut());
  if ((signedOut.error || signedOut.data.error) && sessionTokenToRevoke) {
    await tryCatch(SecureStore.setItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, sessionTokenToRevoke));
  }
  cancelDeviceKeyRegistrations();
  return { phoneRemoved: false };
};
