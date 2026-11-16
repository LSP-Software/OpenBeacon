import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Announcement } from "@openbeacon/schemas";

const stored = new Map<string, string>();

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => stored.set(key, value),
    remove: (key: string) => stored.delete(key),
  },
}));

const useServer = (baseUrl: string) => mock.module("./currentServer.ts", () => ({ baseUrl }));

const importFresh = async (tag: string) => import(`./announcements.ts?${tag}`);

const announcement = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: "one",
  message: "Planned maintenance",
  severity: "info",
  platform: null,
  minAppVersion: null,
  maxAppVersion: null,
  downtimeStartsAt: null,
  downtimeEndsAt: null,
  endsAt: "2026-11-21T10:00:00.000Z",
  ...overrides,
});

const now = new Date("2026-11-20T12:00:00.000Z");

beforeEach(() => {
  stored.clear();
  useServer("https://api.example.test");
});

describe("pickAnnouncement", () => {
  const pick = async (announcements: Announcement[], dismissedIds: string[] = []) => {
    const { pickAnnouncement } = await importFresh("pick");
    return (
      pickAnnouncement({
        announcements,
        dismissedIds,
        platform: "android",
        appVersion: "1.20.0",
        now,
      })?.id ?? null
    );
  };

  test("shows an announcement meant for everyone", async () => {
    expect(await pick([announcement()])).toBe("one");
  });

  test.each([
    [{ platform: "ios" as const }, null],
    [{ platform: "android" as const }, "one"],
    [{ minAppVersion: "1.20.0" }, "one"],
    [{ minAppVersion: "1.20.1" }, null],
    [{ maxAppVersion: "1.20.0" }, "one"],
    [{ maxAppVersion: "1.9.99" }, null],
    [{ minAppVersion: "1.3.0", maxAppVersion: "1.100.0" }, "one"],
    [{ endsAt: "2026-11-20T12:00:00.000Z" }, null],
  ])("targets %j", async (overrides, expected) => {
    expect(await pick([announcement(overrides)])).toBe(expected);
  });

  test("skips dismissed announcements and puts warnings first", async () => {
    const announcements = [
      announcement({ id: "info" }),
      announcement({ id: "warning", severity: "warning" }),
    ];
    expect(await pick(announcements)).toBe("warning");
    expect(await pick(announcements, ["warning"])).toBe("info");
    expect(await pick(announcements, ["warning", "info"])).toBeNull();
  });
});

describe("healthAnnouncementsSchema", () => {
  test("keeps the announcements it understands and drops the rest", async () => {
    const { healthAnnouncementsSchema } = await importFresh("schema");
    expect(
      healthAnnouncementsSchema.parse([
        announcement(),
        announcement({ id: "future", severity: "critical" as "warning" }),
        "nonsense",
      ]),
    ).toEqual([announcement()]);
    expect(healthAnnouncementsSchema.parse(undefined)).toEqual([]);
    expect(healthAnnouncementsSchema.parse({ not: "a list" })).toEqual([]);
  });
});

describe("announcement store", () => {
  test("remembers dismissals across launches until the server stops sending that announcement", async () => {
    const first = await importFresh("store-1");
    first.saveAnnouncements([announcement({ id: "a" }), announcement({ id: "b" })]);
    first.dismissAnnouncement("a");

    const relaunched = await importFresh("store-2");
    relaunched.saveAnnouncements([announcement({ id: "a" })]);
    expect(JSON.parse(stored.get("announcements") ?? "{}").dismissedIds).toEqual(["a"]);

    relaunched.saveAnnouncements([announcement({ id: "c" })]);
    expect(JSON.parse(stored.get("announcements") ?? "{}").dismissedIds).toEqual([]);
  });

  test("forgets another server's announcements", async () => {
    const first = await importFresh("server-1");
    first.saveAnnouncements([announcement({ id: "a" })]);
    first.dismissAnnouncement("a");

    useServer("https://family.example.test");
    const switched = await importFresh("server-2");
    switched.saveAnnouncements([announcement({ id: "a" })]);
    expect(JSON.parse(stored.get("announcements") ?? "{}")).toEqual({
      serverUrl: "https://family.example.test",
      announcements: [announcement({ id: "a" })],
      dismissedIds: [],
    });
  });
});

describe("formatDowntime", () => {
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  test("names today and tomorrow and gives both times in local time", async () => {
    const { formatDowntime } = await importFresh("format");
    const start = new Date(now.getTime() + 2 * 3_600_000);
    const end = new Date(start.getTime() + 3_600_000);
    const sameDay =
      start.toDateString() === now.toDateString() && end.toDateString() === start.toDateString();
    if (sameDay) {
      expect(formatDowntime(start, end, now)).toBe(
        `Down today from ${time(start.toISOString())} to ${time(end.toISOString())}`,
      );
    }
    const tomorrowStart = new Date(now);
    tomorrowStart.setDate(now.getDate() + 1);
    tomorrowStart.setHours(9, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setHours(10, 0, 0, 0);
    expect(formatDowntime(tomorrowStart, tomorrowEnd, now)).toBe(
      `Down tomorrow from ${time(tomorrowStart.toISOString())} to ${time(tomorrowEnd.toISOString())}`,
    );
    const overnightEnd = new Date(tomorrowStart);
    overnightEnd.setDate(tomorrowStart.getDate() + 1);
    expect(formatDowntime(now, overnightEnd, now)).toStartWith(
      `Down from today at ${time(now.toISOString())} to `,
    );
  });
});
