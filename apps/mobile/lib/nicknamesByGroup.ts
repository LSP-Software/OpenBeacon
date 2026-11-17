import { tryCatch } from "@openbeacon/shared";
import { loadPersonalNicknames } from "./personalNicknames.ts";

export const nicknamesByGroup = (userId: string) => {
  const loaded = new Map<string, Promise<Record<string, { name: string | null }>>>();
  return (groupId: string) => {
    const nicknames =
      loaded.get(groupId) ??
      tryCatch(loadPersonalNicknames(groupId, userId)).then((result) => result.data ?? {});
    loaded.set(groupId, nicknames);
    return nicknames;
  };
};
