import type { Href } from "expo-router";
import { useSyncExternalStore } from "react";

export type InAppNotice = { id: number; title: string; body: string | null; href: Href };

let notices: InAppNotice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const publish = (next: InAppNotice[]) => {
  notices = next;
  for (const listener of listeners) listener();
};

export const showInAppNotice = (notice: Omit<InAppNotice, "id">) => {
  publish([...notices, { ...notice, id: nextId++ }].slice(-5));
};

export const dismissInAppNotice = (id: number) => {
  publish(notices.filter((notice) => notice.id !== id));
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useCurrentInAppNotice = () =>
  useSyncExternalStore(subscribe, () => notices[0] ?? null);
