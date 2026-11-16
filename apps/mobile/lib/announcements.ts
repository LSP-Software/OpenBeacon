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

const dismissalSchema = z.object({
  id: z.string(),
  endsAt: z.iso.datetime(),
  dismissedAt: z.iso.datetime(),
});

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
  return { announcements: saved.announcements, dismissed: saved.dismissed };
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
  const dismissed = unexpired(
    state.dismissed.map((dismissal) => {
      const endsAt = announcements.find(({ id }) => id === dismissal.id)?.endsAt;
      return endsAt && new Date(endsAt) > new Date(dismissal.endsAt)
        ? { ...dismissal, endsAt }
        : dismissal;
    }),
  );
  setState({ announcements, dismissed });
};

export const dismissAnnouncement = ({ id, endsAt }: Announcement, now = new Date()) => {
  setState({
    ...state,
    dismissed: [
      ...unexpired(state.dismissed).filter((dismissal) => dismissal.id !== id),
      { id, endsAt, dismissedAt: now.toISOString() },
    ],
  });
};

const reshowBeforeDowntimeMs = 60 * 60_000;

const isDismissed = (
  announcement: Announcement,
  dismissed: { id: string; dismissedAt: string }[],
  now: Date,
) => {
  const dismissal = dismissed.find(({ id }) => id === announcement.id);
  if (!dismissal) return false;
  if (!announcement.downtimeStartsAt || !announcement.downtimeEndsAt) return true;
  const reshowAt = new Date(announcement.downtimeStartsAt).getTime() - reshowBeforeDowntimeMs;
  return (
    new Date(dismissal.dismissedAt).getTime() >= reshowAt ||
    now.getTime() < reshowAt ||
    now >= new Date(announcement.downtimeEndsAt)
  );
};

export const pickAnnouncement = ({
  announcements,
  dismissed,
  platform,
  appVersion,
  now,
}: {
  announcements: Announcement[];
  dismissed: { id: string; dismissedAt: string }[];
  platform: NonNullable<Announcement["platform"]>;
  appVersion: string;
  now: Date;
}) => {
  const shown = announcements.filter(
    (announcement) =>
      !isDismissed(announcement, dismissed, now) &&
      new Date(announcement.endsAt) > now &&
      (announcement.platform === null || announcement.platform === platform) &&
      (announcement.minAppVersion === null ||
        compareAppVersions(appVersion, announcement.minAppVersion) >= 0) &&
      (announcement.maxAppVersion === null ||
        compareAppVersions(appVersion, announcement.maxAppVersion) <= 0),
  );
  return shown.find((announcement) => announcement.severity === "warning") ?? shown[0] ?? null;
};

export const nextAnnouncementCheck = (announcements: Announcement[], now: Date) => {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const times = announcements.flatMap((announcement) => [
    new Date(announcement.endsAt).getTime(),
    ...(announcement.downtimeStartsAt && announcement.downtimeEndsAt
      ? [
          new Date(announcement.downtimeStartsAt).getTime() - reshowBeforeDowntimeMs,
          new Date(announcement.downtimeEndsAt).getTime(),
        ]
      : []),
  ]);
  return new Date(
    Math.min(
      midnight.getTime(),
      now.getTime() + 60 * 60_000,
      ...times.filter((time) => time > now.getTime()),
    ),
  );
};

export const useAnnouncements = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
