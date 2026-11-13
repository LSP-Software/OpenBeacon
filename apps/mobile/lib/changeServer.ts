import { tryCatch } from "@openbeacon/shared";
import { getServerUrl, setServerUrl } from "./currentServer.ts";
import { endSession } from "./endSession.ts";

export const changeServer = async (url: string) => {
  if (url !== getServerUrl()) await tryCatch(endSession({ reason: "serverChanged" }));
  setServerUrl(url);
};
