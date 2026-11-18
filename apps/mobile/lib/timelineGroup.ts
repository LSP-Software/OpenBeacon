import { storage } from "./storage.ts";

const storageKey = (userId: string) => `timeline.groupId.${userId}`;

export const rememberTimelineGroup = (userId: string, groupId: string) =>
  storage.set(storageKey(userId), groupId);

export const pickTimelineGroupId = ({
  groupIds,
  hiddenGroupIds,
  userId,
}: {
  groupIds: readonly string[];
  hiddenGroupIds: ReadonlySet<string>;
  userId: string;
}) => {
  const remembered = storage.getString(storageKey(userId));
  if (remembered && groupIds.includes(remembered)) return remembered;
  return groupIds.find((groupId) => !hiddenGroupIds.has(groupId)) ?? groupIds[0] ?? null;
};
