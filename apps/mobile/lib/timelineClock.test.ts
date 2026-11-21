import { expect, test } from "bun:test";
import {
  formatTimelineClock,
  formatTimelineDayEnd,
  formatTimelineHourTick,
  timelineHourTicks,
} from "./timelineClock.ts";

const evening = new Date(2026, 10, 19, 21, 5).getTime();
const midnight = new Date(2026, 10, 20).getTime();

test("a 24-hour phone gets 24-hour times, a 12-hour phone gets 12-hour times", () => {
  expect(formatTimelineClock(evening, true)).toBe("21:05");
  expect(formatTimelineClock(evening, false)).toMatch(/^9:05\s?PM$/i);
  expect(formatTimelineClock(new Date(2026, 10, 19, 0, 30).getTime(), true)).toBe("00:30");
});

test("the end of the day reads 24:00 only on a 24-hour phone", () => {
  expect(formatTimelineDayEnd(midnight, true)).toBe("24:00");
  expect(formatTimelineDayEnd(midnight, false)).toMatch(/^12:00\s?AM$/i);
});

test("scrubber ticks follow the phone's clock", () => {
  expect([0, 6, 12, 18, 24].map((hour) => formatTimelineHourTick(hour, true))).toEqual([
    "00",
    "06",
    "12",
    "18",
    "24",
  ]);
  expect(
    [0, 6, 12, 18, 24].map((hour) => formatTimelineHourTick(hour, false).replace(/\s/g, " ")),
  ).toEqual(["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"]);
});

test("scrubber keeps every six-hour tick while the labels fit and drops to midnight and noon when they don't", () => {
  expect(timelineHourTicks({ labelWidth: 32, trackWidth: 300 })).toEqual([0, 6, 12, 18, 24]);
  expect(timelineHourTicks({ labelWidth: 75, trackWidth: 300 })).toEqual([0, 6, 12, 18, 24]);
  expect(timelineHourTicks({ labelWidth: 80, trackWidth: 300 })).toEqual([0, 12, 24]);
});
