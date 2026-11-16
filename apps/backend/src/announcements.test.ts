import { describe, expect, test } from "bun:test";
import type { Announcement, PrismaClient } from "@openbeacon/database";
import { announcementSchema } from "@openbeacon/schemas";
import { currentAnnouncements, refreshAnnouncements } from "./announcements.ts";

const row = (overrides: Partial<Announcement>): Announcement => ({
  id: "0196a1b2-0000-7000-8000-000000000001",
  message: "Planned maintenance",
  severity: "INFO",
  platform: null,
  minAppVersion: null,
  maxAppVersion: null,
  downtimeStartsAt: null,
  downtimeEndsAt: null,
  startsAt: new Date("2026-11-20T09:00:00.000Z"),
  endsAt: new Date("2026-11-21T10:00:00.000Z"),
  createdAt: new Date("2026-11-20T08:00:00.000Z"),
  ...overrides,
});

const databaseReturning = (result: () => Promise<Announcement[]>) =>
  ({ announcement: { findMany: result } }) as unknown as Pick<PrismaClient, "announcement">;

describe("announcements", () => {
  test("serves only announcements whose window has started and not ended, in the wire format", async () => {
    await refreshAnnouncements(
      databaseReturning(async () => [
        row({
          severity: "WARNING",
          platform: "ANDROID",
          maxAppVersion: "1.20.0",
          downtimeStartsAt: new Date("2026-11-21T09:00:00.000Z"),
          downtimeEndsAt: new Date("2026-11-21T10:00:00.000Z"),
        }),
        row({ id: "upcoming", startsAt: new Date("2026-11-20T18:00:00.000Z") }),
      ]),
    );

    const shown = currentAnnouncements(new Date("2026-11-20T12:00:00.000Z"));
    expect(shown).toEqual([
      {
        id: "0196a1b2-0000-7000-8000-000000000001",
        message: "Planned maintenance",
        severity: "warning",
        platform: "android",
        minAppVersion: null,
        maxAppVersion: "1.20.0",
        downtimeStartsAt: "2026-11-21T09:00:00.000Z",
        downtimeEndsAt: "2026-11-21T10:00:00.000Z",
        endsAt: "2026-11-21T10:00:00.000Z",
      },
    ]);
    expect(shown.every((announcement) => announcementSchema.safeParse(announcement).success)).toBe(
      true,
    );
    expect(currentAnnouncements(new Date("2026-11-20T19:00:00.000Z")).map(({ id }) => id)).toEqual([
      "0196a1b2-0000-7000-8000-000000000001",
      "upcoming",
    ]);
    expect(currentAnnouncements(new Date("2026-11-21T10:00:00.000Z"))).toEqual([]);
  });

  test("keeps serving the last announcements it loaded when the database can't be read", async () => {
    await refreshAnnouncements(databaseReturning(async () => [row({})]));
    await refreshAnnouncements(
      databaseReturning(async () => {
        throw new Error("connection refused");
      }),
    );
    expect(currentAnnouncements(new Date("2026-11-20T12:00:00.000Z"))).toHaveLength(1);
  });
});
