import { storage } from "./storage.ts";

export const GROUP_COLOR_PALETTE = [
  "#FF1464",
  "#E85D4C",
  "#2A9D8F",
  "#457B9D",
  "#E9C46A",
  "#9B5DE5",
  "#00BBF9",
  "#F15BB5",
  "#00F5D4",
] as const;

export type GroupColor = (typeof GROUP_COLOR_PALETTE)[number];

export const GROUP_COLOR_NAMES: Record<GroupColor, string> = {
  "#FF1464": "Pink",
  "#E85D4C": "Coral",
  "#2A9D8F": "Teal",
  "#457B9D": "Steel blue",
  "#E9C46A": "Yellow",
  "#9B5DE5": "Purple",
  "#00BBF9": "Sky blue",
  "#F15BB5": "Rose",
  "#00F5D4": "Aqua",
};

const STORAGE_PREFIX = "group.color.";
const storageKey = (groupId: string) => `${STORAGE_PREFIX}${groupId}`;

const listeners = new Set<() => void>();
let revision = 0;

export const isGroupColor = (value: string | undefined): value is GroupColor => {
  return GROUP_COLOR_PALETTE.some((color) => color === value);
};

export const getGroupColor = (groupId: string): GroupColor => {
  const stored = storage.getString(storageKey(groupId));
  if (isGroupColor(stored)) {
    return stored;
  }
  return GROUP_COLOR_PALETTE[0];
};

export const getGroupColorRevision = () => revision;

export const subscribeToGroupColorChanges = (listener: () => void) => {
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

export const setGroupColor = (groupId: string, color: GroupColor) => {
  if (!isGroupColor(color)) {
    throw new Error("Group color must be chosen from the palette");
  }
  storage.set(storageKey(groupId), color);
  notifyListeners();
};

export const clearGroupColors = () => {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(STORAGE_PREFIX)) storage.remove(key);
  }
  notifyListeners();
};
