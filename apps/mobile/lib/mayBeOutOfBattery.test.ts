import { describe, expect, test } from "bun:test";
import { mayBeOutOfBattery } from "./mayBeOutOfBattery.ts";

const timestamp = "2026-11-19T12:00:00.000Z";
const stale = Date.parse("2026-11-19T14:00:00.000Z");
const low = { charging: false, level: 3 };

describe("mayBeOutOfBattery", () => {
  test("says so when the battery was low and nothing has arrived for over 30 minutes", () => {
    expect(mayBeOutOfBattery({ battery: low, now: stale, timestamp })).toBe(true);
    expect(
      mayBeOutOfBattery({ battery: { charging: false, level: 10 }, now: stale, timestamp }),
    ).toBe(true);
  });

  test("waits out the gaps a stationary phone leaves between uploads", () => {
    expect(
      mayBeOutOfBattery({ battery: low, now: Date.parse("2026-11-19T12:30:00.000Z"), timestamp }),
    ).toBe(false);
    expect(
      mayBeOutOfBattery({ battery: low, now: Date.parse("2026-11-19T12:30:00.001Z"), timestamp }),
    ).toBe(true);
  });

  test("stays quiet when the battery wasn't low, was charging or is unknown", () => {
    expect(
      mayBeOutOfBattery({ battery: { charging: false, level: 11 }, now: stale, timestamp }),
    ).toBe(false);
    expect(
      mayBeOutOfBattery({ battery: { charging: true, level: 3 }, now: stale, timestamp }),
    ).toBe(false);
    expect(
      mayBeOutOfBattery({ battery: { charging: false, level: null }, now: stale, timestamp }),
    ).toBe(false);
    expect(mayBeOutOfBattery({ battery: null, now: stale, timestamp })).toBe(false);
    expect(mayBeOutOfBattery({ battery: low, now: stale, timestamp: null })).toBe(false);
  });
});
