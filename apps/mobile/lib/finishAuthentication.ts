import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import { createHistoryKeyIfMissing } from "./createHistoryKey.ts";
import { isThisDeviceActive } from "./deviceActivation.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";
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
  const active = registration.data ? await tryCatch(isThisDeviceActive()) : null;
  if (active?.data === false && registration.data) {
    if (joinCode) savePendingJoinCode({ code: joinCode, userId: registration.data.userId });
    else clearPendingJoinCodes();
    router.replace("/setup");
    return;
  }
  clearPendingJoinCodes();
  if (newAccount && registration.data) {
    await tryCatch(createHistoryKeyIfMissing(registration.data.userId));
  }
  if (joinCode) {
    router.replace({ pathname: "/join", params: { code: joinCode } });
    return;
  }
  router.replace("/");
};
