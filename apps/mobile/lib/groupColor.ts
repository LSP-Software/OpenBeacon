import { storage } from "./storage.ts";

export const GROUP_COLOR_PALETTE = [
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

const hashGroupId = (groupId: string) => {
  let hash = 0;
  for (let index = 0; index < groupId.length; index += 1) {
    hash = (hash * 31 + groupId.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const isGroupColor = (value: string | undefined): value is GroupColor => {
  return GROUP_COLOR_PALETTE.some((color) => color === value);
};

export const getDefaultGroupColor = (groupId: string): GroupColor => {
  const color = GROUP_COLOR_PALETTE[hashGroupId(groupId) % GROUP_COLOR_PALETTE.length];
  if (!color) {
    return GROUP_COLOR_PALETTE[0];
  }
  return color;
};

export const getGroupColor = (groupId: string): GroupColor => {
  const stored = storage.getString(storageKey(groupId));
  if (isGroupColor(stored)) {
    return stored;
  }
  return getDefaultGroupColor(groupId);
};

export const setGroupColor = (groupId: string, color: string) => {
  if (!isGroupColor(color)) {
    throw new Error("Group color must be chosen from the palette");
  }
  storage.set(storageKey(groupId), color);
};
