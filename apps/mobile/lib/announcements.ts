import { type Announcement, announcementSchema, compareAppVersions } from "@openbeacon/schemas";
import { useSyncExternalStore } from "react";
import { z } from "zod";
import { baseUrl } from "./currentServer.ts";
import { storage } from "./storage.ts";

export const healthAnnouncementsSchema = z
  .array(announcementSchema.nullable().catch(null))
  .max(20)
  .optional()
  .catch(undefined)
  .transform((announcements) =>
    (announcements ?? []).filter((announcement) => announcement !== null),
  );

const savedSchema = z.object({
  serverUrl: z.string(),
  announcements: z.array(announcementSchema),
  dismissedIds: z.array(z.string()),
});

const storageKey = "announcements";

const loadSaved = () => {
  const raw = storage.getString(storageKey);
  if (raw === undefined) return { announcements: [], dismissedIds: [] };
  let saved: z.infer<typeof savedSchema>;
  try {
    saved = savedSchema.parse(JSON.parse(raw));
  } catch {
    storage.remove(storageKey);
    return { announcements: [], dismissedIds: [] };
  }
  if (saved.serverUrl !== baseUrl) {
    storage.remove(storageKey);
    return { announcements: [], dismissedIds: [] };
  }
  return { announcements: saved.announcements, dismissedIds: saved.dismissedIds };
};

let state: { announcements: Announcement[]; dismissedIds: string[] } = loadSaved();
const listeners = new Set<() => void>();

const setState = (next: typeof state) => {
  state = next;
  storage.set(storageKey, JSON.stringify({ serverUrl: baseUrl, ...next }));
  for (const listener of listeners) listener();
};

export const saveAnnouncements = (announcements: Announcement[]) => {
  const ids = new Set(announcements.map((announcement) => announcement.id));
  setState({
    announcements,
    dismissedIds: state.dismissedIds.filter((id) => ids.has(id)),
  });
};

export const dismissAnnouncement = (id: string) => {
  if (state.dismissedIds.includes(id)) return;
  setState({ ...state, dismissedIds: [...state.dismissedIds, id] });
};

export const pickAnnouncement = ({
  announcements,
  dismissedIds,
  platform,
  appVersion,
  now,
}: {
  announcements: Announcement[];
  dismissedIds: string[];
  platform: string;
  appVersion: string;
  now: Date;
}) => {
  const shown = announcements.filter(
    (announcement) =>
      !dismissedIds.includes(announcement.id) &&
      new Date(announcement.endsAt) > now &&
      (announcement.platform === null || announcement.platform === platform) &&
      (announcement.minAppVersion === null ||
        compareAppVersions(appVersion, announcement.minAppVersion) >= 0) &&
      (announcement.maxAppVersion === null ||
        compareAppVersions(appVersion, announcement.maxAppVersion) <= 0),
  );
  return shown.find((announcement) => announcement.severity === "warning") ?? shown[0] ?? null;
};

export const formatDowntime = (startsAt: Date, endsAt: Date, now: Date) => {
  const sameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();
  const time = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (date: Date) => {
    if (sameDay(date, now)) return "today";
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    if (sameDay(date, tomorrow)) return "tomorrow";
    return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  };
  return sameDay(startsAt, endsAt)
    ? `Down ${day(startsAt)} from ${time(startsAt)} to ${time(endsAt)}`
    : `Down from ${day(startsAt)} at ${time(startsAt)} to ${day(endsAt)} at ${time(endsAt)}`;
};

export const useAnnouncements = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
