import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import { createHistoryKeyIfMissing } from "./createHistoryKey.ts";
import { isThisDeviceActive } from "./deviceActivation.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";
import { startOnboarding } from "./onboarding.ts";
import { clearPendingJoinCodes, savePendingJoinCode } from "./pendingJoinCode.ts";

export const finishAuthentication = async ({
  joinCode,
  newAccount = false,
}: {
  joinCode: string | undefined;
  newAccount?: boolean;
}) => {
  const registration = await tryCatch(ensureDeviceKeyRegistration());
  if (isDeviceRemovedError(registration.error)) return;
  if (!registration.data) {
    clearPendingJoinCodes();
    router.replace(joinCode ? { pathname: "/join", params: { code: joinCode } } : "/");
    return;
  }
  const { userId } = registration.data;
  const active = await tryCatch(isThisDeviceActive());
  const pending = active.data === false;
  if (joinCode) savePendingJoinCode({ code: joinCode, userId });
  else clearPendingJoinCodes();
  if (newAccount && !pending) await tryCatch(createHistoryKeyIfMissing(userId));
  startOnboarding(userId, pending ? "newDevice" : newAccount ? "newAccount" : "returning");
  router.replace("/onboarding");
};
