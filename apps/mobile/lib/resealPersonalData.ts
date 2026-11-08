import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { syncGroupColors } from "./groupColorSync.ts";
import { loadPersonalNicknames } from "./personalNicknames.ts";

export const resealPersonalData = async (userId: string) => {
  await tryCatch(syncGroupColors(userId));
  const groups = await tryCatch(trpcClient.groupMembership.list.query());
  for (const { id } of groups.data ?? []) {
    await tryCatch(loadPersonalNicknames(id, userId));
  }
};
