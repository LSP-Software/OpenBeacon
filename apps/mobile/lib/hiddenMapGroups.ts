import { storage } from "./storage.ts";

const storageKey = (userId: string) => `map.hiddenGroups.${userId}`;
const listeners = new Set<() => void>();
let revision = 0;

export const getHiddenMapGroupIds = (userId: string): string[] => {
  const stored = storage.getString(storageKey(userId));
  if (!stored) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
};

export const getHiddenMapGroupsRevision = () => revision;

export const subscribeToHiddenMapGroups = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notifyListeners = () => {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
};

export const setMapGroupHidden = ({
  groupId,
  hidden,
  userId,
}: {
  groupId: string;
  hidden: boolean;
  userId: string;
}) => {
  const others = getHiddenMapGroupIds(userId).filter((id) => id !== groupId);
  storage.set(storageKey(userId), JSON.stringify(hidden ? [...others, groupId] : others));
  notifyListeners();
};

export const forgetHiddenMapGroup = ({ groupId, userId }: { groupId: string; userId: string }) =>
  setMapGroupHidden({ groupId, hidden: false, userId });
