import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MAX_TIMELINE_POINTS, pickTimelinePeople } from "./timelineBudget.ts";
import { localDayOf } from "./timelineDays.ts";

const originalTimeZone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Europe/London";
});

afterAll(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

const noon = Date.parse("2026-07-14T11:00:00Z");
const device = (senderUserId: string, count: number, hour = "2026-07-14T10:00:00Z") => ({
  hours: [{ count, hour: Date.parse(hour) / 3_600_000 }],
  senderUserId,
});
const pick = ({
  chosen = null,
  devices,
  selectedUserId = null,
}: {
  chosen?: string[] | null;
  devices: ReturnType<typeof device>[];
  selectedUserId?: string | null;
}) =>
  pickTimelinePeople({
    chosen,
    day: localDayOf(noon),
    devices,
    memberIds: ["ana", "ben", "cat", "dan"],
    selectedUserId,
  });

const heavy = MAX_TIMELINE_POINTS / 2;

describe("pickTimelinePeople", () => {
  test("shows everyone when they fit, with former members after members", () => {
    const result = pick({
      devices: [device("ben", 2_000), device("gone", 500), device("ana", 1_000), device("ana", 10)],
    });
    expect(result.everyoneFits).toBe(true);
    expect(result.shown).toEqual(["ana", "ben", "cat", "dan", "gone"]);
    expect(result.people).toEqual([
      { points: 1_010, userId: "ana" },
      { points: 2_000, userId: "ben" },
      { points: 0, userId: "cat" },
      { points: 0, userId: "dan" },
      { points: 500, userId: "gone" },
    ]);
  });

  test("adds members in order while they fit and skips anyone who doesn't", () => {
    const result = pick({
      devices: [device("ana", heavy), device("ben", heavy + 1), device("cat", heavy)],
    });
    expect(result.everyoneFits).toBe(false);
    expect(result.shown).toEqual(["ana", "cat", "dan"]);
  });

  test("puts the selected person first", () => {
    const result = pick({
      devices: [device("ana", heavy), device("ben", heavy), device("cat", heavy)],
      selectedUserId: "cat",
    });
    expect(result.shown).toEqual(["cat", "ana", "dan"]);
  });

  test("keeps the people chosen on a busy day, still within the limit, plus anyone with no locations", () => {
    const devices = [device("ana", heavy), device("ben", heavy), device("cat", heavy)];
    expect(pick({ chosen: ["ben", "cat"], devices }).shown).toEqual(["ben", "cat", "dan"]);
    expect(pick({ chosen: ["ana", "ben", "cat"], devices }).shown).toEqual(["ana", "ben", "dan"]);
    expect(pick({ chosen: ["ben"], devices, selectedUserId: "ana" }).shown).toEqual([
      "ana",
      "ben",
      "dan",
    ]);
  });

  test("ignores an old choice once everyone fits", () => {
    const result = pick({ chosen: ["ben"], devices: [device("ana", 10), device("ben", 10)] });
    expect(result.shown).toEqual(["ana", "ben", "cat", "dan"]);
  });

  test("always shows at least one person", () => {
    const result = pick({
      devices: [device("ana", MAX_TIMELINE_POINTS + 1), device("ben", MAX_TIMELINE_POINTS + 1)],
    });
    expect(result.shown).toEqual(["ana", "cat", "dan"]);
    expect(
      pick({ chosen: ["ben"], devices: [device("ben", MAX_TIMELINE_POINTS * 2)] }).shown,
    ).toEqual(["ben", "ana", "cat", "dan"]);
  });

  test("counts only the day's own hours, 23 of them on the day the clocks go forward", () => {
    const day = localDayOf(Date.parse("2026-03-29T12:00:00Z"));
    const hours = (counts: Array<[string, number]>) =>
      counts.map(([hour, count]) => ({ count, hour: Date.parse(hour) / 3_600_000 }));
    const result = pickTimelinePeople({
      chosen: null,
      day,
      devices: [
        {
          hours: hours([
            ["2026-03-28T23:00:00Z", 1],
            ["2026-03-29T00:00:00Z", 10],
            ["2026-03-29T22:00:00Z", 100],
            ["2026-03-29T23:00:00Z", 1_000],
          ]),
          senderUserId: "ana",
        },
        {
          hours: hours([["2026-03-29T05:00:00Z", 7]]),
          senderUserId: "ben",
        },
      ],
      memberIds: ["ana", "ben"],
      selectedUserId: null,
    });
    expect(result.people).toEqual([
      { points: 110, userId: "ana" },
      { points: 7, userId: "ben" },
    ]);
  });
});
