import { tryCatch } from "@openbeacon/shared";
import { saveJoinLinkForAfterSetup } from "../lib/pendingJoinCode.ts";

export const redirectSystemPath = async ({ path }: { path: string; initial: boolean }) => {
  const saved = await tryCatch(Promise.resolve().then(() => saveJoinLinkForAfterSetup(path)));
  return saved.data ? null : path;
};
