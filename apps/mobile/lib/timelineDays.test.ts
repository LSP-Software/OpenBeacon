import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildTimelineDayPicker, localDayOf, timelineWindowStart } from "./timelineDays.ts";
import { timelineFetchWindow } from "./timelineLoad.ts";

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
  entries.map(([hour, count]) => ({ count, hour: hourOf(hour) }));

const hourOf = (time: string) => Math.floor(Date.parse(time) / HOUR_MS);

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

describe("timelineFetchWindow", () => {
  const windowOf = (time: string) => {
    const { fromHour, toHour } = timelineFetchWindow(localDayOf(Date.parse(time)));
    return [new Date(fromHour * HOUR_MS).toISOString(), toHour - fromHour];
  };

  test("a normal day asks for its own 24 UTC hours", () => {
    expect(windowOf("2026-07-14T12:00:00Z")).toEqual(["2026-07-13T23:00:00.000Z", 24]);
  });

  test("the day the clocks go back asks for 25 hours and the day they go forward for 23", () => {
    expect(windowOf("2026-10-25T12:00:00Z")).toEqual(["2026-10-24T23:00:00.000Z", 25]);
    expect(windowOf("2026-03-29T12:00:00Z")).toEqual(["2026-03-29T00:00:00.000Z", 23]);
  });

  test("a +5:30 day takes in both half hours at its edges", () => {
    process.env.TZ = "Asia/Kolkata";
    try {
      expect(windowOf("2026-07-14T06:00:00Z")).toEqual(["2026-07-13T18:00:00.000Z", 25]);
    } finally {
      process.env.TZ = "Europe/London";
    }
  });
});

describe("timelineWindowStart", () => {
  test("reaches back to the oldest recorded hour, so a point uploaded long after it was recorded still has its day", () => {
    const windowStart = new Date("2026-11-04T03:00:00Z");
    const devices = [
      { firstHour: hourOf("2026-10-30T18:00:00Z") },
      { firstHour: hourOf("2026-11-10T09:00:00Z") },
    ];
    const start = timelineWindowStart({ devices, windowStart });
    expect(start.toISOString()).toBe("2026-10-30T18:00:00.000Z");
    expect(
      buildTimelineDayPicker({
        devices: [{ firstHour: devices[0]!.firstHour, hours: [], senderUserId: "alice" }],
        now: Date.parse("2026-11-18T12:00:00Z"),
        windowStart: start,
      })[0]?.key,
    ).toBe("2026-10-30");
  });

  test("stays at the server's window when nothing was recorded before it", () => {
    const windowStart = new Date("2026-11-04T03:00:00Z");
    expect(
      timelineWindowStart({
        devices: [{ firstHour: hourOf("2026-11-05T00:00:00Z") }],
        windowStart,
      }),
    ).toEqual(windowStart);
    expect(timelineWindowStart({ devices: [], windowStart })).toEqual(windowStart);
  });
});

describe("buildTimelineDayPicker", () => {
  test("groups UTC hours into local days when the clocks go forward", () => {
    const days = buildTimelineDayPicker({
      devices: [
        {
          firstHour: hourOf("2026-03-28T23:10:00Z"),
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
          firstHour: hourOf("2026-10-24T22:05:00Z"),
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
          firstHour: hourOf("2026-07-02T18:00:00Z"),
          hours: hours(["2026-07-02T18:00:00Z", 3], ["2026-07-04T09:00:00Z", 5]),
          senderUserId: "alice",
        },
        {
          firstHour: hourOf("2026-07-04T08:00:00Z"),
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
          firstHour: hourOf("2026-07-02T18:00:00Z"),
          hours: hours(["2026-07-02T18:00:00Z", 3]),
          senderUserId: "alice",
        },
        {
          firstHour: hourOf("2026-07-03T08:00:00Z"),
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

describe("buildTimelineDayPicker in zones offset by part of an hour", () => {
  const pickDays = (receivedAt: string) =>
    buildTimelineDayPicker({
      devices: [
        {
          firstHour: hourOf(receivedAt),
          hours: hours([`${receivedAt.slice(0, 13)}:00:00Z`, 3]),
          senderUserId: "alice",
        },
      ],
      now: Date.parse("2026-07-04T06:00:00Z"),
      windowStart: new Date("2026-07-01T06:00:00Z"),
    }).map(({ key, pointCount, selectable }) => [key, pointCount, selectable]);

  const inTimeZone = (timeZone: string, run: () => void) => {
    process.env.TZ = timeZone;
    try {
      run();
    } finally {
      process.env.TZ = "Europe/London";
    }
  };

  test("Kolkata: a point at 23:45 dots that day and the next, which its hour runs into", () => {
    inTimeZone("Asia/Kolkata", () => {
      expect(pickDays("2026-07-02T18:15:00Z")).toEqual([
        ["2026-07-01", 0, false],
        ["2026-07-02", 3, true],
        ["2026-07-03", 3, true],
        ["2026-07-04", 0, true],
      ]);
    });
  });

  test("Kathmandu: a point at 23:45 dots that day and the next, which its hour runs into", () => {
    inTimeZone("Asia/Kathmandu", () => {
      expect(pickDays("2026-07-02T18:00:00Z")).toEqual([
        ["2026-07-01", 0, false],
        ["2026-07-02", 3, true],
        ["2026-07-03", 3, true],
        ["2026-07-04", 0, true],
      ]);
    });
  });

  test("Kathmandu: an hour that ends at 23:45 dots only its own day", () => {
    inTimeZone("Asia/Kathmandu", () => {
      expect(pickDays("2026-07-02T17:25:00Z")).toEqual([
        ["2026-07-01", 0, false],
        ["2026-07-02", 3, true],
        ["2026-07-03", 0, true],
        ["2026-07-04", 0, true],
      ]);
    });
  });

  test("London: a point at 23:45 dots only its own day", () => {
    expect(pickDays("2026-07-02T22:45:00Z")).toEqual([
      ["2026-07-01", 0, false],
      ["2026-07-02", 3, true],
      ["2026-07-03", 0, true],
      ["2026-07-04", 0, true],
    ]);
  });
});
