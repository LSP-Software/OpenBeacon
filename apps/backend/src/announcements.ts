import type { Announcement as AnnouncementRow } from "@openbeacon/database";
import type { Announcement } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";

let upcoming: AnnouncementRow[] = [];

export const refreshAnnouncements = async (
  database: {
    announcement: {
      findMany: (args: {
        where: { startsAt: { gt?: Date; lte: Date }; endsAt: { gt: Date } };
        orderBy: [{ severity: "desc" }, { startsAt: "desc" }, { id: "asc" }];
        take: number;
      }) => Promise<AnnouncementRow[]>;
    };
  },
  now = new Date(),
) => {
  const orderBy = [{ severity: "desc" }, { startsAt: "desc" }, { id: "asc" }] as const;
  const soon = new Date(now.getTime() + 60_000);
  const rows = await tryCatch(
    Promise.all([
      database.announcement.findMany({
        where: { startsAt: { lte: now }, endsAt: { gt: now } },
        orderBy: [...orderBy],
        take: 20,
      }),
      database.announcement.findMany({
        where: { startsAt: { gt: now, lte: soon }, endsAt: { gt: now } },
        orderBy: [...orderBy],
        take: 20,
      }),
    ]),
  );
  if (rows.error) {
    console.error(`Could not load announcements: ${rows.error.message}`);
    return;
  }
  upcoming = rows.data.flat();
};

export const currentAnnouncements = (now = new Date()): Announcement[] =>
  upcoming
    .filter((row) => row.startsAt <= now && row.endsAt > now)
    .sort(
      (left, right) =>
        Number(right.severity === "WARNING") - Number(left.severity === "WARNING") ||
        right.startsAt.getTime() - left.startsAt.getTime() ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      message: row.message,
      severity: ({ INFO: "info", WARNING: "warning" } as const)[row.severity],
      platform: row.platform && ({ ANDROID: "android", IOS: "ios" } as const)[row.platform],
      minAppVersion: row.minAppVersion,
      maxAppVersion: row.maxAppVersion,
      downtimeStartsAt: row.downtimeStartsAt?.toISOString() ?? null,
      downtimeEndsAt: row.downtimeEndsAt?.toISOString() ?? null,
      endsAt: row.endsAt.toISOString(),
    }));
