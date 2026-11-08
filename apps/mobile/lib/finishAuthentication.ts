import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import { findMissingHistoryKey } from "./recovery.ts";
import { storage } from "./storage.ts";

export const finishAuthentication = async ({ joinCode }: { joinCode: string | undefined }) => {
  if (joinCode) {
    router.replace({ pathname: "/join", params: { code: joinCode } });
    return;
  }
  const missing = await tryCatch(findMissingHistoryKey());
  if (
    missing.data &&
    (storage.getNumber(`recovery.restoreDeclined.${missing.data.userId}`) ?? 0) <
      missing.data.version
  ) {
    router.replace({
      pathname: "/account/recovery-restore",
      params: { afterSignIn: "true", missingVersion: String(missing.data.version) },
    });
    return;
  }
  router.replace("/");
};
