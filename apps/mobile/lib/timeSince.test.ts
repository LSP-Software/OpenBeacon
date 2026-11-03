import { describe, expect, test } from "bun:test";
import { getTimeSinceRefreshIntervalMs, timeSince } from "./timeSince.ts";

describe("timeSince", () => {
  test("formats minutes, hours and days with their remaining units", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");

    expect(timeSince(now - 45_000, now)).toBe("45 seconds ago");
    expect(timeSince(now - 60_000, now)).toBe("1 minute ago");
    expect(timeSince(now - 59 * 60_000, now)).toBe("59 minutes ago");
    expect(timeSince(now - 60 * 60_000, now)).toBe("1 hour and 0 minutes ago");
    expect(timeSince(now - 125 * 60_000, now)).toBe("2 hours and 5 minutes ago");
    expect(timeSince(now - 1_440 * 60_000, now)).toBe("1 day, 0 hours and 0 minutes ago");
    expect(timeSince(now - 3_002 * 60_000, now)).toBe("2 days, 2 hours and 2 minutes ago");
    expect(timeSince("invalid", now)).toBe("just now");
    expect(timeSince(now + 1_000, now)).toBe("just now");
  });
});

describe("getTimeSinceRefreshIntervalMs", () => {
  test("refreshes at the next displayed second or minute", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");

    expect(getTimeSinceRefreshIntervalMs(now - 1_000, now)).toBe(1_000);
    expect(getTimeSinceRefreshIntervalMs(now - 90_500, now)).toBe(29_500);
    expect(getTimeSinceRefreshIntervalMs(now - 3_600_000, now)).toBe(60_000);
    expect(getTimeSinceRefreshIntervalMs(now - 86_400_000, now)).toBe(60_000);
  });
});
