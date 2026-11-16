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

const importFresh = async (tag: string): Promise<typeof import("./announcements.ts")> =>
  import(`./announcements.ts?${tag}`);

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
        dismissed: dismissedIds.map((id) => ({ id })),
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
        { ...announcement({ id: "future" }), severity: "critical" },
        "nonsense",
      ]),
    ).toEqual([announcement()]);
    expect(healthAnnouncementsSchema.parse(undefined)).toEqual([]);
    expect(healthAnnouncementsSchema.parse({ not: "a list" })).toEqual([]);
  });

  test("keeps the first 20 valid announcements of a longer list", async () => {
    const { healthAnnouncementsSchema } = await importFresh("schema-long");
    const announcements = Array.from({ length: 25 }, (_, index) =>
      announcement({ id: `a${index}` }),
    );
    expect(healthAnnouncementsSchema.parse(["nonsense", ...announcements])).toEqual(
      announcements.slice(0, 20),
    );
  });
});

describe("announcement store", () => {
  const future = "2999-01-01T00:00:00.000Z";

  const shownId = (store: typeof import("./announcements.ts")) => {
    const { announcements, dismissed } = store.getAnnouncementState();
    return (
      store.pickAnnouncement({
        announcements,
        dismissed,
        platform: "android",
        appVersion: "1.20.0",
        now: new Date(),
      })?.id ?? null
    );
  };

  test("keeps a dismissed announcement hidden after a relaunch while the server still sends it", async () => {
    const first = await importFresh("relaunch-1");
    first.saveAnnouncements([announcement({ id: "a", endsAt: future })]);
    first.dismissAnnouncement(announcement({ id: "a", endsAt: future }));
    expect(shownId(first)).toBeNull();

    const relaunched = await importFresh("relaunch-2");
    relaunched.saveAnnouncements([announcement({ id: "a", endsAt: future })]);
    expect(shownId(relaunched)).toBeNull();
  });

  test("keeps a dismissal when the server briefly sends no announcements", async () => {
    const store = await importFresh("gap");
    const sent = announcement({ id: "a", endsAt: future });
    store.saveAnnouncements([sent]);
    store.dismissAnnouncement(sent);

    store.saveAnnouncements([]);
    store.saveAnnouncements([sent]);
    expect(shownId(store)).toBeNull();
  });

  test("keeps a dismissal when the server extends the announcement", async () => {
    const store = await importFresh("extended");
    const soon = new Date(Date.now() + 60_000).toISOString();
    store.dismissAnnouncement(announcement({ id: "a", endsAt: soon }));
    store.saveAnnouncements([announcement({ id: "a", endsAt: future })]);
    expect(store.getAnnouncementState().dismissed).toEqual([{ id: "a", endsAt: future }]);
  });

  test("forgets dismissals once their announcement has ended", async () => {
    const store = await importFresh("expired-save");
    store.dismissAnnouncement(announcement({ id: "current", endsAt: future }));
    store.dismissAnnouncement(announcement({ id: "old", endsAt: "2000-01-01T00:00:00.000Z" }));
    store.saveAnnouncements([]);
    expect(store.getAnnouncementState().dismissed).toEqual([{ id: "current", endsAt: future }]);

    stored.set(
      "announcements",
      JSON.stringify({
        serverUrl: "https://api.example.test",
        announcements: [],
        dismissed: [
          { id: "old", endsAt: "2000-01-01T00:00:00.000Z" },
          { id: "current", endsAt: future },
        ],
      }),
    );
    const relaunched = await importFresh("expired-load");
    expect(relaunched.getAnnouncementState().dismissed).toEqual([
      { id: "current", endsAt: future },
    ]);
  });

  test("starts fresh when the saved data has an older shape", async () => {
    stored.set(
      "announcements",
      JSON.stringify({
        serverUrl: "https://api.example.test",
        announcements: [announcement({ id: "a", endsAt: future })],
        dismissedIds: ["a"],
      }),
    );
    const store = await importFresh("old-shape");
    expect(store.getAnnouncementState()).toEqual({ announcements: [], dismissed: [] });
    expect(stored.has("announcements")).toBe(false);
  });

  test("forgets another server's announcements", async () => {
    const first = await importFresh("server-1");
    first.saveAnnouncements([announcement({ id: "a", endsAt: future })]);
    first.dismissAnnouncement(announcement({ id: "a", endsAt: future }));

    useServer("https://family.example.test");
    const switched = await importFresh("server-2");
    switched.saveAnnouncements([announcement({ id: "a", endsAt: future })]);
    expect(shownId(switched)).toBe("a");
  });
});
