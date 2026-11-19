import { describe, expect, test } from "bun:test";
import { lowBatteryWhenLastSeen } from "./lowBatteryWhenLastSeen.ts";

const timestamp = "2026-11-19T12:00:00.000Z";
const stale = Date.parse("2026-11-19T14:00:00.000Z");
const fresh = Date.parse("2026-11-19T12:05:00.000Z");

describe("lowBatteryWhenLastSeen", () => {
  test("gives the last level when the battery was low and the location is out of date", () => {
    expect(
      lowBatteryWhenLastSeen({
        battery: { charging: false, level: 3 },
        now: stale,
        timestamp,
      }),
    ).toBe(3);
    expect(
      lowBatteryWhenLastSeen({
        battery: { charging: false, level: 10 },
        now: stale,
        timestamp,
      }),
    ).toBe(10);
  });

  test("stays quiet while the location is still recent", () => {
    expect(
      lowBatteryWhenLastSeen({ battery: { charging: false, level: 3 }, now: fresh, timestamp }),
    ).toBeNull();
  });

  test("stays quiet when the battery wasn't low, was charging or is unknown", () => {
    expect(
      lowBatteryWhenLastSeen({ battery: { charging: false, level: 11 }, now: stale, timestamp }),
    ).toBeNull();
    expect(
      lowBatteryWhenLastSeen({ battery: { charging: true, level: 3 }, now: stale, timestamp }),
    ).toBeNull();
    expect(
      lowBatteryWhenLastSeen({ battery: { charging: false, level: null }, now: stale, timestamp }),
    ).toBeNull();
    expect(lowBatteryWhenLastSeen({ battery: null, now: stale, timestamp })).toBeNull();
    expect(
      lowBatteryWhenLastSeen({
        battery: { charging: false, level: 3 },
        now: stale,
        timestamp: null,
      }),
    ).toBeNull();
  });
});
