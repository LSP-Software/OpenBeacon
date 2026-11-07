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

const storageKey = (groupId: string) => `group.color.${groupId}`;

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

export const setGroupColor = (groupId: string, color: GroupColor) => {
  if (!isGroupColor(color)) {
    throw new Error("Group color must be chosen from the palette");
  }
  storage.set(storageKey(groupId), color);
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
};
