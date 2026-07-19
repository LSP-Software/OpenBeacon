import { describe, expect, test } from "bun:test";
import { getTimeSinceRefreshIntervalMs, timeSince } from "./timeSince.ts";

describe("timeSince", () => {
  test("formats elapsed time in the coarsest matching unit", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");

    expect(timeSince(now - 1_000, now)).toBe("1 second ago");
    expect(timeSince(now - 45_000, now)).toBe("45 seconds ago");
    expect(timeSince(now - 60_000, now)).toBe("1 minute ago");
    expect(timeSince(now - 3_600_000, now)).toBe("1 hour ago");
    expect(timeSince(now - 86_400_000, now)).toBe("1 day ago");
  });
});

describe("getTimeSinceRefreshIntervalMs", () => {
  test("returns a low-frequency clock matched to the displayed unit", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");

    expect(getTimeSinceRefreshIntervalMs(now - 1_000, now)).toBe(1_000);
    expect(getTimeSinceRefreshIntervalMs(now - 45_000, now)).toBe(1_000);
    expect(getTimeSinceRefreshIntervalMs(now - 60_000, now)).toBe(60_000);
    expect(getTimeSinceRefreshIntervalMs(now - 3_600_000, now)).toBe(3_600_000);
    expect(getTimeSinceRefreshIntervalMs(now - 86_400_000, now)).toBe(86_400_000);
  });
});
