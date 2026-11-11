import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import { createHistoryKeyIfMissing } from "./createHistoryKey.ts";
import { isThisDeviceActive } from "./deviceActivation.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";

export const finishAuthentication = async ({
  joinCode,
  newAccount = false,
}: {
  joinCode: string | undefined;
  newAccount?: boolean;
}) => {
  const registration = await tryCatch(ensureDeviceKeyRegistration());
  const active = registration.data ? await tryCatch(isThisDeviceActive()) : null;
  if (active?.data === false) {
    router.replace("/setup");
    return;
  }
  if (newAccount && registration.data) {
    await tryCatch(createHistoryKeyIfMissing(registration.data.userId));
  }
  if (joinCode) {
    router.replace({ pathname: "/join", params: { code: joinCode } });
    return;
  }
  router.replace("/");
};
