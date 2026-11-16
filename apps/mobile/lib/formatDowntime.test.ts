import { describe, expect, test } from "bun:test";
import { formatDowntime } from "./formatDowntime.ts";

describe("formatDowntime", () => {
  const now = new Date(2026, 10, 20, 12, 0);
  const time = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const date = (value: Date) =>
    value.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  test("says today when the downtime is later today", () => {
    const startsAt = new Date(2026, 10, 20, 14, 0);
    const endsAt = new Date(2026, 10, 20, 15, 30);

    expect(formatDowntime(startsAt, endsAt, now)).toBe(
      `Down today from ${time(startsAt)} to ${time(endsAt)}`,
    );
  });

  test("says tomorrow when the downtime is the next day", () => {
    const startsAt = new Date(2026, 10, 21, 9, 0);
    const endsAt = new Date(2026, 10, 21, 10, 0);

    expect(formatDowntime(startsAt, endsAt, now)).toBe(
      `Down tomorrow from ${time(startsAt)} to ${time(endsAt)}`,
    );
  });

  test("handles tomorrow across a month end", () => {
    const startsAt = new Date(2026, 11, 1, 8, 0);
    const endsAt = new Date(2026, 11, 1, 9, 0);

    expect(formatDowntime(startsAt, endsAt, new Date(2026, 10, 30, 20, 0))).toBe(
      `Down tomorrow from ${time(startsAt)} to ${time(endsAt)}`,
    );
  });

  test("uses the date when the downtime is later than tomorrow", () => {
    const startsAt = new Date(2026, 10, 23, 9, 0);
    const endsAt = new Date(2026, 10, 23, 11, 0);

    expect(formatDowntime(startsAt, endsAt, now)).toBe(
      `Down ${date(startsAt)} from ${time(startsAt)} to ${time(endsAt)}`,
    );
  });

  test("names both days when the downtime runs past midnight", () => {
    const startsAt = new Date(2026, 10, 20, 23, 0);
    const endsAt = new Date(2026, 10, 22, 2, 0);

    expect(formatDowntime(startsAt, endsAt, now)).toBe(
      `Down from today at ${time(startsAt)} to ${date(endsAt)} at ${time(endsAt)}`,
    );
  });
});
