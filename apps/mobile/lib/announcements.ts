import { type Announcement, announcementSchema, compareAppVersions } from "@openbeacon/schemas";
import { useSyncExternalStore } from "react";
import { z } from "zod";
import { baseUrl } from "./currentServer.ts";
import { storage } from "./storage.ts";

export const healthAnnouncementsSchema = z
  .array(announcementSchema.nullable().catch(null))
  .optional()
  .catch(undefined)
  .transform((announcements) =>
    (announcements ?? []).filter((announcement) => announcement !== null).slice(0, 20),
  );

const dismissalSchema = z.object({ id: z.string(), endsAt: z.iso.datetime() });

const savedSchema = z.object({
  serverUrl: z.string(),
  announcements: z.array(announcementSchema),
  dismissed: z.array(dismissalSchema),
});

const storageKey = "announcements";

const unexpired = (dismissed: z.infer<typeof dismissalSchema>[]) =>
  dismissed.filter((dismissal) => new Date(dismissal.endsAt).getTime() > Date.now());

const loadSaved = () => {
  const empty = { announcements: [], dismissed: [] };
  const raw = storage.getString(storageKey);
  if (raw === undefined) return empty;
  let saved: z.infer<typeof savedSchema>;
  try {
    saved = savedSchema.parse(JSON.parse(raw));
  } catch {
    storage.remove(storageKey);
    return empty;
  }
  if (saved.serverUrl !== baseUrl) {
    storage.remove(storageKey);
    return empty;
  }
  return { announcements: saved.announcements, dismissed: unexpired(saved.dismissed) };
};

let state: {
  announcements: Announcement[];
  dismissed: z.infer<typeof dismissalSchema>[];
} = loadSaved();
const listeners = new Set<() => void>();

const setState = (next: typeof state) => {
  state = next;
  storage.set(storageKey, JSON.stringify({ serverUrl: baseUrl, ...next }));
  for (const listener of listeners) listener();
};

export const getAnnouncementState = () => state;

export const saveAnnouncements = (announcements: Announcement[]) => {
  const dismissed = unexpired(state.dismissed).map((dismissal) => {
    const endsAt = announcements.find(({ id }) => id === dismissal.id)?.endsAt;
    return endsAt && new Date(endsAt) > new Date(dismissal.endsAt)
      ? { ...dismissal, endsAt }
      : dismissal;
  });
  setState({ announcements, dismissed });
};

export const dismissAnnouncement = ({ id, endsAt }: Announcement) => {
  if (state.dismissed.some((dismissal) => dismissal.id === id)) return;
  setState({ ...state, dismissed: [...unexpired(state.dismissed), { id, endsAt }] });
};

export const pickAnnouncement = ({
  announcements,
  dismissed,
  platform,
  appVersion,
  now,
}: {
  announcements: Announcement[];
  dismissed: { id: string }[];
  platform: NonNullable<Announcement["platform"]>;
  appVersion: string;
  now: Date;
}) => {
  const shown = announcements.filter(
    (announcement) =>
      !dismissed.some((dismissal) => dismissal.id === announcement.id) &&
      new Date(announcement.endsAt) > now &&
      (announcement.platform === null || announcement.platform === platform) &&
      (announcement.minAppVersion === null ||
        compareAppVersions(appVersion, announcement.minAppVersion) >= 0) &&
      (announcement.maxAppVersion === null ||
        compareAppVersions(appVersion, announcement.maxAppVersion) <= 0),
  );
  return shown.find((announcement) => announcement.severity === "warning") ?? shown[0] ?? null;
};

export const useAnnouncements = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
