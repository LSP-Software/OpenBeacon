import { describe, expect, test } from "bun:test";
import type { Announcement } from "@openbeacon/database";
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

const databaseReturning = (result: () => Promise<Announcement[]>) => ({
  announcement: {
    findMany: async ({
      where,
    }: {
      where: { startsAt: { gt?: Date; lte: Date }; endsAt: { gt: Date } };
    }) =>
      (await result()).filter(
        (announcement) =>
          announcement.startsAt <= where.startsAt.lte &&
          (where.startsAt.gt === undefined || announcement.startsAt > where.startsAt.gt) &&
          announcement.endsAt > where.endsAt.gt,
      ),
  },
});

describe("announcements", () => {
  test("serves only announcements whose window has started and not ended, in the wire format", async () => {
    const database = databaseReturning(async () => [
      row({
        severity: "WARNING",
        platform: "ANDROID",
        maxAppVersion: "1.20.0",
        downtimeStartsAt: new Date("2026-11-21T09:00:00.000Z"),
        downtimeEndsAt: new Date("2026-11-21T10:00:00.000Z"),
      }),
      row({ id: "upcoming", startsAt: new Date("2026-11-20T18:00:00.000Z") }),
    ]);
    await refreshAnnouncements(database, new Date("2026-11-20T12:00:00.000Z"));

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
    await refreshAnnouncements(database, new Date("2026-11-20T19:00:00.000Z"));
    expect(currentAnnouncements(new Date("2026-11-20T19:00:00.000Z")).map(({ id }) => id)).toEqual([
      "0196a1b2-0000-7000-8000-000000000001",
      "upcoming",
    ]);
    expect(currentAnnouncements(new Date("2026-11-21T10:00:00.000Z"))).toEqual([]);
  });

  test("asks for the 20 showing now and, separately, up to 20 starting within a minute", async () => {
    const received: unknown[] = [];
    await refreshAnnouncements(
      {
        announcement: {
          findMany: async (args) => {
            received.push(args);
            return [];
          },
        },
      },
      new Date("2026-11-20T12:00:00.000Z"),
    );
    const orderBy = [{ severity: "desc" }, { startsAt: "desc" }, { id: "asc" }];
    const now = new Date("2026-11-20T12:00:00.000Z");
    expect(received).toEqual([
      { where: { startsAt: { lte: now }, endsAt: { gt: now } }, orderBy, take: 20 },
      {
        where: {
          startsAt: { gt: now, lte: new Date("2026-11-20T12:01:00.000Z") },
          endsAt: { gt: now },
        },
        orderBy,
        take: 20,
      },
    ]);
  });

  test("keeps an announcement that is showing when 20 more are about to start", async () => {
    const now = new Date("2026-11-20T12:00:00.000Z");
    const soon = Array.from({ length: 20 }, (_, index) =>
      row({
        id: `soon-${index}`,
        severity: "WARNING",
        startsAt: new Date("2026-11-20T12:00:50.000Z"),
      }),
    );
    await refreshAnnouncements(
      databaseReturning(async () => [row({ id: "showing" }), ...soon]),
      now,
    );
    expect(currentAnnouncements(now).map(({ id }) => id)).toEqual(["showing"]);
    const later = currentAnnouncements(new Date("2026-11-20T12:01:00.000Z"));
    expect(later).toHaveLength(20);
    expect(later.every(({ severity }) => severity === "warning")).toBe(true);
  });

  test("keeps serving the last announcements it loaded when the database can't be read", async () => {
    const now = new Date("2026-11-20T12:00:00.000Z");
    await refreshAnnouncements(
      databaseReturning(async () => [row({})]),
      now,
    );
    await refreshAnnouncements(
      databaseReturning(async () => {
        throw new Error("connection refused");
      }),
      now,
    );
    expect(currentAnnouncements(new Date("2026-11-20T12:00:00.000Z"))).toHaveLength(1);
  });
});
