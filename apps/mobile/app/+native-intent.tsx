import { tryCatch } from "@openbeacon/shared";
import { saveJoinLinkForAfterSetup } from "../lib/pendingJoinCode.ts";

export const redirectSystemPath = async ({ path, initial }: { path: string; initial: boolean }) => {
  if (/^openbeacon:\/\/\/?google-deletion(?:[/?#]|$)/i.test(path)) return initial ? "/" : null;
  const saved = await tryCatch(Promise.resolve().then(() => saveJoinLinkForAfterSetup(path)));
  return saved.data ? null : path;
};
