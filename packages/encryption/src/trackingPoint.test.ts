import { describe, expect, test } from "bun:test";
import type { TrackingPointV1 } from "./index.ts";
import { encodeTrackingPointV1, TRACKING_POINT_KIND, validateTrackingPointV1 } from "./index.ts";

const validTrackingPoint = {
  v: 1,
  latitude: 51.5074,
  longitude: -0.1278,
  timestamp: "2026-07-13T18:45:00.000Z",
  speed: 1.4,
  battery: {
    level: 72,
    charging: false,
  },
} satisfies TrackingPointV1;

describe("validateTrackingPointV1", () => {
  test("accepts a valid tracking point", () => {
    expect(validateTrackingPointV1(validTrackingPoint)).toEqual(validTrackingPoint);
  });

  test("rejects battery levels outside the integer percentage range", () => {
    for (const level of [-1, 72.5, 101]) {
      expect(() =>
        validateTrackingPointV1({
          ...validTrackingPoint,
          battery: {
            ...validTrackingPoint.battery,
            level,
          },
        }),
      ).toThrow("Invalid tracking point.");
    }
  });

  test("requires every schema field", () => {
    for (const field of Object.keys(validTrackingPoint)) {
      const invalidTrackingPoint = { ...validTrackingPoint };
      Reflect.deleteProperty(invalidTrackingPoint, field);

      expect(() => validateTrackingPointV1(invalidTrackingPoint)).toThrow(
        "Invalid tracking point.",
      );
    }

    for (const field of Object.keys(validTrackingPoint.battery)) {
      const invalidBattery = { ...validTrackingPoint.battery };
      Reflect.deleteProperty(invalidBattery, field);

      expect(() =>
        validateTrackingPointV1({
          ...validTrackingPoint,
          battery: invalidBattery,
        }),
      ).toThrow("Invalid tracking point.");
    }
  });

  test("accepts a numeric or null speed and rejects other values", () => {
    expect(validateTrackingPointV1({ ...validTrackingPoint, speed: null }).speed).toBeNull();
    expect(validateTrackingPointV1(validTrackingPoint).speed).toBe(1.4);
    expect(() => validateTrackingPointV1({ ...validTrackingPoint, speed: "1.4" })).toThrow(
      "Invalid tracking point.",
    );
  });

  test("encodes the locked tracking payload as UTF-8 JSON", () => {
    const encoded = encodeTrackingPointV1(validTrackingPoint);

    expect(TRACKING_POINT_KIND).toBe("trackingPoint");
    expect(new TextDecoder().decode(encoded)).toBe(
      '{"v":1,"latitude":51.5074,"longitude":-0.1278,"timestamp":"2026-07-13T18:45:00.000Z","speed":1.4,"battery":{"level":72,"charging":false}}',
    );
  });

  test("encoding refuses fields outside the v1 plaintext schema", () => {
    expect(() =>
      encodeTrackingPointV1({ ...validTrackingPoint, accuracy: 4 } as TrackingPointV1),
    ).toThrow("Invalid tracking point.");
    expect(() =>
      encodeTrackingPointV1({
        ...validTrackingPoint,
        battery: { ...validTrackingPoint.battery, state: "full" },
      } as TrackingPointV1),
    ).toThrow("Invalid tracking point.");
  });

  test("encodes an unknown battery level as null", () => {
    expect(
      new TextDecoder().decode(
        encodeTrackingPointV1({
          ...validTrackingPoint,
          battery: { level: null, charging: false },
        }),
      ),
    ).toContain('"battery":{"level":null,"charging":false}');
  });

  test("rejects coordinates outside WGS84 bounds and non-UTC timestamps", () => {
    for (const value of [
      { ...validTrackingPoint, latitude: -91 },
      { ...validTrackingPoint, latitude: 91 },
      { ...validTrackingPoint, longitude: -181 },
      { ...validTrackingPoint, longitude: 181 },
      { ...validTrackingPoint, timestamp: "2026-07-13T19:45:00.000+01:00" },
      { ...validTrackingPoint, timestamp: "not-a-date" },
    ]) {
      expect(() => validateTrackingPointV1(value)).toThrow("Invalid tracking point.");
    }
  });

  test("accepts valid ISO 8601 UTC precision and rejects impossible dates", () => {
    expect(
      validateTrackingPointV1({
        ...validTrackingPoint,
        timestamp: "2026-07-13T18:45:00.1234Z",
      }).timestamp,
    ).toBe("2026-07-13T18:45:00.1234Z");
    expect(() =>
      validateTrackingPointV1({
        ...validTrackingPoint,
        timestamp: "2026-02-30T18:45:00Z",
      }),
    ).toThrow("Invalid tracking point.");
  });

  test("drops fields outside the v1 plaintext schema", () => {
    const read = validateTrackingPointV1({
      ...validTrackingPoint,
      accuracy: 4,
      battery: {
        ...validTrackingPoint.battery,
        state: "full",
      },
    });

    expect(read).toEqual(validTrackingPoint);
    expect(Object.keys(read)).toEqual(Object.keys(validTrackingPoint));
    expect(Object.keys(read.battery)).toEqual(Object.keys(validTrackingPoint.battery));
  });

  test("returns a copy rather than the decoded object", () => {
    const decoded = structuredClone(validTrackingPoint);
    const read = validateTrackingPointV1(decoded);

    expect(read).not.toBe(decoded);
    expect(read.battery).not.toBe(decoded.battery);
  });

  test("accepts an unknown battery level as null", () => {
    expect(
      validateTrackingPointV1({
        ...validTrackingPoint,
        battery: { level: null, charging: true },
      }).battery,
    ).toEqual({ level: null, charging: true });
  });

  test("still rejects other versions", () => {
    expect(() => validateTrackingPointV1({ ...validTrackingPoint, v: 2 })).toThrow(
      "Invalid tracking point.",
    );
  });
});
