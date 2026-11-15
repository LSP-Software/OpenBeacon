import { describe, expect, test } from "bun:test";
import type { PlaceGeometryV1 } from "./index.ts";
import {
  decodeJsonPayload,
  decryptGroupPayload,
  encodePlaceGeometryV1,
  encryptGroupPayload,
  generateGroupEpochKey,
  PLACE_GEOMETRY_KIND,
  TRACKING_POINT_KIND,
  validatePlaceGeometryV1,
} from "./index.ts";

const validGeometry = {
  v: 1,
  latitude: 51.5074,
  longitude: -0.1278,
  radiusMeters: 150,
} satisfies PlaceGeometryV1;

const metadata = {
  epochId: "epoch_1",
  groupId: "group_1",
  kind: PLACE_GEOMETRY_KIND,
  senderDeviceId: "device_1",
};

describe("validatePlaceGeometryV1", () => {
  test("accepts a valid geometry and returns a copy", () => {
    const read = validatePlaceGeometryV1(validGeometry);

    expect(read).toEqual(validGeometry);
    expect(read).not.toBe(validGeometry);
  });

  test("accepts every radius from 100 to 1000 metres in steps of 25", () => {
    for (let radiusMeters = 100; radiusMeters <= 1000; radiusMeters += 25) {
      expect(validatePlaceGeometryV1({ ...validGeometry, radiusMeters }).radiusMeters).toBe(
        radiusMeters,
      );
    }
  });

  test("rejects radii outside the range or off the 25 metre steps", () => {
    for (const radiusMeters of [0, 75, 99, 101, 110, 137.5, 1025, 1000.5, -150, Number.NaN]) {
      expect(() => validatePlaceGeometryV1({ ...validGeometry, radiusMeters })).toThrow(
        "Invalid place geometry.",
      );
    }
  });

  test("rejects missing fields", () => {
    for (const field of Object.keys(validGeometry)) {
      const invalidGeometry = { ...validGeometry };
      Reflect.deleteProperty(invalidGeometry, field);

      expect(() => validatePlaceGeometryV1(invalidGeometry)).toThrow("Invalid place geometry.");
    }
  });

  test("rejects extra fields, including the plain-text name and emoji", () => {
    for (const extra of [{ name: "Home" }, { emoji: "🏠" }, { accuracy: 4 }]) {
      expect(() => validatePlaceGeometryV1({ ...validGeometry, ...extra })).toThrow(
        "Invalid place geometry.",
      );
    }
  });

  test("rejects coordinates outside WGS84 bounds or not finite", () => {
    for (const value of [
      { ...validGeometry, latitude: -90.0001 },
      { ...validGeometry, latitude: 90.0001 },
      { ...validGeometry, longitude: -180.0001 },
      { ...validGeometry, longitude: 180.0001 },
      { ...validGeometry, latitude: Number.POSITIVE_INFINITY },
      { ...validGeometry, longitude: Number.NaN },
      { ...validGeometry, latitude: "51.5074" },
    ]) {
      expect(() => validatePlaceGeometryV1(value)).toThrow("Invalid place geometry.");
    }
  });

  test("rejects other versions and non-objects", () => {
    for (const value of [{ ...validGeometry, v: 2 }, null, "geometry", 150, []]) {
      expect(() => validatePlaceGeometryV1(value)).toThrow("Invalid place geometry.");
    }
  });
});

describe("encodePlaceGeometryV1", () => {
  test("encodes the locked geometry payload as UTF-8 JSON", () => {
    expect(new TextDecoder().decode(encodePlaceGeometryV1(validGeometry))).toBe(
      '{"v":1,"latitude":51.5074,"longitude":-0.1278,"radiusMeters":150}',
    );
  });

  test("refuses fields outside the v1 schema", () => {
    expect(() =>
      encodePlaceGeometryV1({ ...validGeometry, name: "Home" } as PlaceGeometryV1),
    ).toThrow("Invalid place geometry.");
  });
});

describe("place geometry group payload", () => {
  test("round trips through encryptGroupPayload and decryptGroupPayload", () => {
    const epochKey = generateGroupEpochKey();
    const encrypted = encryptGroupPayload({
      ...metadata,
      epochKey,
      payload: encodePlaceGeometryV1(validGeometry),
    });
    const decrypted = decryptGroupPayload({
      encryptedPayload: encrypted,
      epochKey,
      expectedMetadata: metadata,
    });

    expect(encrypted.kind).toBe(PLACE_GEOMETRY_KIND);
    expect(encrypted.ciphertext).not.toContain("51.5074");
    expect(validatePlaceGeometryV1(decodeJsonPayload(decrypted.bytes))).toEqual(validGeometry);
  });

  test("rejects a payload whose kind, group, epoch or sender device doesn't match", () => {
    const epochKey = generateGroupEpochKey();
    const encrypted = encryptGroupPayload({
      ...metadata,
      epochKey,
      payload: encodePlaceGeometryV1(validGeometry),
    });

    for (const mismatch of [
      { kind: TRACKING_POINT_KIND },
      { groupId: "group_2" },
      { epochId: "epoch_2" },
      { senderDeviceId: "device_2" },
    ]) {
      expect(() =>
        decryptGroupPayload({
          encryptedPayload: encrypted,
          epochKey,
          expectedMetadata: { ...metadata, ...mismatch },
        }),
      ).toThrow("Encrypted payload metadata mismatch.");

      expect(() =>
        decryptGroupPayload({
          encryptedPayload: { ...encrypted, ...mismatch },
          epochKey,
          expectedMetadata: { ...metadata, ...mismatch },
        }),
      ).toThrow();
    }
  });

  test("rejects a payload sealed under another epoch key", () => {
    const encrypted = encryptGroupPayload({
      ...metadata,
      epochKey: generateGroupEpochKey(),
      payload: encodePlaceGeometryV1(validGeometry),
    });

    expect(() =>
      decryptGroupPayload({
        encryptedPayload: encrypted,
        epochKey: generateGroupEpochKey(),
        expectedMetadata: metadata,
      }),
    ).toThrow();
  });
});
