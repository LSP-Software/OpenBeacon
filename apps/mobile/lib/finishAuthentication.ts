import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import { createHistoryKeyIfMissing } from "./createHistoryKey.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { findMissingHistoryKey } from "./recovery.ts";
import { isRestorePromptSkipped } from "./restoreReminders.ts";

export const finishAuthentication = async ({
  joinCode,
  newAccount = false,
}: {
  joinCode: string | undefined;
  newAccount?: boolean;
}) => {
  if (newAccount) {
    await tryCatch(
      ensureDeviceKeyRegistration().then(({ userId }) => createHistoryKeyIfMissing(userId)),
    );
  }
  if (joinCode) {
    router.replace({ pathname: "/join", params: { code: joinCode } });
    return;
  }
  const missing = await tryCatch(findMissingHistoryKey());
  if (missing.data && !isRestorePromptSkipped(missing.data)) {
    router.replace({
      pathname: "/account/recovery-restore",
      params: { afterSignIn: "true", missingVersion: String(missing.data.version) },
    });
    return;
  }
  router.replace("/");
};
