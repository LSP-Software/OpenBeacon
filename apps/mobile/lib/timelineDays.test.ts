import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildTimelineDayPicker, localDayOf } from "./timelineDays.ts";

const HOUR_MS = 60 * 60_000;
const originalTimeZone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Europe/London";
});

afterAll(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

const hours = (...entries: Array<[string, number]>) =>
  entries.map(([hour, count]) => ({ count, hour: new Date(hour) }));

describe("localDayOf", () => {
  test("the day the clocks go forward is 23 hours long", () => {
    const day = localDayOf(Date.parse("2026-03-29T12:00:00Z"));
    expect(day).toEqual({
      end: Date.parse("2026-03-29T23:00:00Z"),
      key: "2026-03-29",
      start: Date.parse("2026-03-29T00:00:00Z"),
    });
  });

  test("the day the clocks go back is 25 hours long", () => {
    const day = localDayOf(Date.parse("2026-10-25T12:00:00Z"));
    expect(day).toEqual({
      end: Date.parse("2026-10-26T00:00:00Z"),
      key: "2026-10-25",
      start: Date.parse("2026-10-24T23:00:00Z"),
    });
    expect(day.end - day.start).toBe(25 * HOUR_MS);
  });
});

describe("buildTimelineDayPicker", () => {
  test("groups UTC hours into local days when the clocks go forward", () => {
    const days = buildTimelineDayPicker({
      devices: [
        {
          firstReceivedAt: new Date("2026-03-28T23:10:00Z"),
          hours: hours(
            ["2026-03-28T23:00:00Z", 1],
            ["2026-03-29T22:00:00Z", 2],
            ["2026-03-29T23:00:00Z", 4],
          ),
          senderUserId: "alice",
        },
      ],
      now: Date.parse("2026-03-30T10:00:00Z"),
      windowStart: new Date("2026-03-28T10:00:00Z"),
    });

    expect(days.map(({ key, pointCount }) => [key, pointCount])).toEqual([
      ["2026-03-28", 1],
      ["2026-03-29", 2],
      ["2026-03-30", 4],
    ]);
    expect(days[2]?.start).toBe(Date.parse("2026-03-29T23:00:00Z"));
  });

  test("groups UTC hours into local days when the clocks go back", () => {
    const days = buildTimelineDayPicker({
      devices: [
        {
          firstReceivedAt: new Date("2026-10-24T22:05:00Z"),
          hours: hours(
            ["2026-10-24T22:00:00Z", 1],
            ["2026-10-24T23:00:00Z", 2],
            ["2026-10-25T23:00:00Z", 4],
            ["2026-10-26T00:00:00Z", 8],
          ),
          senderUserId: "alice",
        },
      ],
      now: Date.parse("2026-10-26T10:00:00Z"),
      windowStart: new Date("2026-10-24T10:00:00Z"),
    });

    expect(days.map(({ key, pointCount }) => [key, pointCount])).toEqual([
      ["2026-10-24", 1],
      ["2026-10-25", 6],
      ["2026-10-26", 8],
    ]);
  });

  test("greys out only days before the first point, so a long stay's day stays selectable", () => {
    const days = buildTimelineDayPicker({
      devices: [
        {
          firstReceivedAt: new Date("2026-07-02T18:00:00Z"),
          hours: hours(["2026-07-02T18:00:00Z", 3], ["2026-07-04T09:00:00Z", 5]),
          senderUserId: "alice",
        },
        {
          firstReceivedAt: new Date("2026-07-04T08:00:00Z"),
          hours: hours(["2026-07-04T08:00:00Z", 7]),
          senderUserId: "bob",
        },
      ],
      now: Date.parse("2026-07-04T12:00:00Z"),
      windowStart: new Date("2026-07-01T09:00:00Z"),
    });

    expect(days.map(({ key, pointCount, selectable }) => [key, pointCount, selectable])).toEqual([
      ["2026-07-01", 0, false],
      ["2026-07-02", 3, true],
      ["2026-07-03", 0, true],
      ["2026-07-04", 12, true],
    ]);
  });

  test("can show one person's days", () => {
    const days = buildTimelineDayPicker({
      devices: [
        {
          firstReceivedAt: new Date("2026-07-02T18:00:00Z"),
          hours: hours(["2026-07-02T18:00:00Z", 3]),
          senderUserId: "alice",
        },
        {
          firstReceivedAt: new Date("2026-07-03T08:00:00Z"),
          hours: hours(["2026-07-03T08:00:00Z", 7]),
          senderUserId: "bob",
        },
      ],
      now: Date.parse("2026-07-03T12:00:00Z"),
      userId: "bob",
      windowStart: new Date("2026-07-02T09:00:00Z"),
    });

    expect(days.map(({ key, pointCount, selectable }) => [key, pointCount, selectable])).toEqual([
      ["2026-07-02", 0, false],
      ["2026-07-03", 7, true],
    ]);
  });

  test("leaves every day greyed out when nobody has shared yet", () => {
    const days = buildTimelineDayPicker({
      devices: [],
      now: Date.parse("2026-07-03T12:00:00Z"),
      windowStart: new Date("2026-07-02T09:00:00Z"),
    });

    expect(days.map(({ selectable }) => selectable)).toEqual([false, false]);
  });
});
