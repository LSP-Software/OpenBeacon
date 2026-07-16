import { describe, expect, test } from "bun:test";
import { encodeTrackingPointV1, TRACKING_POINT_KIND, validateTrackingPointV1 } from "./index.ts";

describe("validateTrackingPointV1", () => {
  test("accepts a valid tracking point", () => {
    const trackingPoint = {
      v: 1,
      latitude: 51.5074,
      longitude: -0.1278,
      timestamp: "2026-07-13T18:45:00.000Z",
      speed: 1.4,
      battery: {
        level: 72,
        charging: false,
      },
    };

    expect(validateTrackingPointV1(trackingPoint)).toEqual(trackingPoint);
  });

  test("rejects battery levels outside the integer percentage range", () => {
    for (const level of [-1, 72.5, 101]) {
      expect(() =>
        validateTrackingPointV1({
          v: 1,
          latitude: 51.5074,
          longitude: -0.1278,
          timestamp: "2026-07-13T18:45:00.000Z",
          speed: null,
          battery: {
            level,
            charging: true,
          },
        }),
      ).toThrow("Invalid tracking point.");
    }
  });

  test("requires every schema field", () => {
    const trackingPoint = {
      v: 1,
      latitude: 51.5074,
      longitude: -0.1278,
      timestamp: "2026-07-13T18:45:00.000Z",
      speed: null,
      battery: {
        level: 72,
        charging: false,
      },
    };

    for (const field of Object.keys(trackingPoint)) {
      const invalidTrackingPoint = { ...trackingPoint };
      Reflect.deleteProperty(invalidTrackingPoint, field);

      expect(() => validateTrackingPointV1(invalidTrackingPoint)).toThrow(
        "Invalid tracking point.",
      );
    }

    expect(() =>
      validateTrackingPointV1({
        ...trackingPoint,
        battery: {
          level: 72,
        },
      }),
    ).toThrow("Invalid tracking point.");
  });

  test("accepts a numeric or null speed and rejects other values", () => {
    const trackingPoint = {
      v: 1,
      latitude: 51.5074,
      longitude: -0.1278,
      timestamp: "2026-07-13T18:45:00.000Z",
      speed: null,
      battery: {
        level: 72,
        charging: false,
      },
    };

    expect(validateTrackingPointV1(trackingPoint).speed).toBeNull();
    expect(validateTrackingPointV1({ ...trackingPoint, speed: 1.4 }).speed).toBe(1.4);
    expect(() => validateTrackingPointV1({ ...trackingPoint, speed: "1.4" })).toThrow(
      "Invalid tracking point.",
    );
  });

  test("encodes the locked tracking payload as UTF-8 JSON", () => {
    const encoded = encodeTrackingPointV1({
      v: 1,
      latitude: 51.5074,
      longitude: -0.1278,
      timestamp: "2026-07-13T18:45:00.000Z",
      speed: 1.4,
      battery: {
        level: 72,
        charging: false,
      },
    });

    expect(TRACKING_POINT_KIND).toBe("trackingPoint");
    expect(new TextDecoder().decode(encoded)).toBe(
      '{"v":1,"latitude":51.5074,"longitude":-0.1278,"timestamp":"2026-07-13T18:45:00.000Z","speed":1.4,"battery":{"level":72,"charging":false}}',
    );
  });

  test("rejects coordinates outside WGS84 bounds and non-UTC timestamps", () => {
    const trackingPoint = {
      v: 1,
      latitude: 51.5074,
      longitude: -0.1278,
      timestamp: "2026-07-13T18:45:00.000Z",
      speed: 1.4,
      battery: {
        level: 72,
        charging: false,
      },
    };

    for (const value of [
      { ...trackingPoint, latitude: -91 },
      { ...trackingPoint, latitude: 91 },
      { ...trackingPoint, longitude: -181 },
      { ...trackingPoint, longitude: 181 },
      { ...trackingPoint, timestamp: "2026-07-13T19:45:00.000+01:00" },
      { ...trackingPoint, timestamp: "not-a-date" },
    ]) {
      expect(() => validateTrackingPointV1(value)).toThrow("Invalid tracking point.");
    }
  });

  test("rejects fields outside the locked plaintext schema", () => {
    const trackingPoint = {
      v: 1,
      latitude: 51.5074,
      longitude: -0.1278,
      timestamp: "2026-07-13T18:45:00.000Z",
      speed: null,
      battery: {
        level: 72,
        charging: false,
      },
    };

    expect(() => validateTrackingPointV1({ ...trackingPoint, accuracy: 4 })).toThrow(
      "Invalid tracking point.",
    );
    expect(() =>
      validateTrackingPointV1({
        ...trackingPoint,
        battery: {
          ...trackingPoint.battery,
          state: "full",
        },
      }),
    ).toThrow("Invalid tracking point.");
  });
});
