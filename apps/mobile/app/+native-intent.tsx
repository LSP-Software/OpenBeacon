import { tryCatch } from "@openbeacon/shared";
import { saveJoinLinkForAfterSetup } from "../lib/pendingJoinCode.ts";

export const redirectSystemPath = async ({ path }: { path: string; initial: boolean }) => {
  await tryCatch(Promise.resolve().then(() => saveJoinLinkForAfterSetup(path)));
  return path;
};
