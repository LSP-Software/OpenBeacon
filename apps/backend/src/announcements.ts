import type { Announcement as AnnouncementRow, PrismaClient } from "@openbeacon/database";
import type { Announcement } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";

let upcoming: AnnouncementRow[] = [];

export const refreshAnnouncements = async (
  database: Pick<PrismaClient, "announcement">,
  now = new Date(),
) => {
  const rows = await tryCatch(
    database.announcement.findMany({
      where: { endsAt: { gt: now } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 20,
    }),
  );
  if (rows.error) {
    console.error(`Could not load announcements: ${rows.error.message}`);
    return;
  }
  upcoming = rows.data;
};

export const currentAnnouncements = (now = new Date()): Announcement[] =>
  upcoming
    .filter((row) => row.startsAt <= now && row.endsAt > now)
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
