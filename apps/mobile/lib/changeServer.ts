import { tryCatch } from "@openbeacon/shared";
import { clearApiCompatibility, refreshApiCompatibility } from "./apiCompatibility.ts";
import { getServerUrl, setServerUrl } from "./currentServer.ts";
import { endSession } from "./endSession.ts";

export const changeServer = async (url: string) => {
  const changed = url !== getServerUrl();
  if (changed) await tryCatch(endSession({ reason: "serverChanged" }));
  setServerUrl(url);
  if (!changed) return;
  clearApiCompatibility();
  void tryCatch(refreshApiCompatibility({ userRequested: true }));
};
