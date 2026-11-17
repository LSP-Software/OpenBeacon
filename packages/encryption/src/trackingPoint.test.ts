import { describe, expect, test } from "bun:test";
import type { TrackingPoint } from "./index.ts";
import { decodeTrackingPoint, encodeTrackingPoint, TRACKING_POINT_KIND } from "./index.ts";

const point = {
  latitude: 51.5074,
  longitude: -0.1278,
  time: Date.parse("2026-07-13T18:45:00.000Z"),
  stayUntil: null,
  accuracy: 4.8,
  speed: 1.4,
  battery: { level: 72, charging: false },
} satisfies TrackingPoint;

describe("tracking points", () => {
  test("keep the kind bound into the encryption's associated data", () => {
    expect(TRACKING_POINT_KIND).toBe("trackingPoint");
  });

  test("encoding refuses coordinates and times that aren't finite", () => {
    for (const value of [
      { ...point, latitude: Number.NaN },
      { ...point, longitude: Number.POSITIVE_INFINITY },
      { ...point, time: Number.NaN },
      { ...point, time: 1.5 },
      { ...point, stayUntil: Number.NaN },
    ]) {
      expect(() => encodeTrackingPoint(value)).toThrow("Invalid tracking point.");
    }
  });

  test("writes accuracy, speed and battery levels that aren't finite as unknown", () => {
    expect(
      decodeTrackingPoint(
        encodeTrackingPoint({
          ...point,
          accuracy: Number.NaN,
          speed: Number.POSITIVE_INFINITY,
          battery: { level: Number.NaN, charging: true },
        }),
      ),
    ).toEqual({ ...point, accuracy: null, speed: null, battery: { level: null, charging: true } });
  });

  test("decodes a point that sits inside a larger buffer", () => {
    const buffer = new Uint8Array(40);
    buffer.set(encodeTrackingPoint(point), 9);

    expect(decodeTrackingPoint(buffer.subarray(9, 32))).toEqual(point);
  });
});
