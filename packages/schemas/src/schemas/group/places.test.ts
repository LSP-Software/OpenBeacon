import { describe, expect, test } from "bun:test";
import {
  PAYLOAD_ENCRYPTION_ALGORITHM,
  PLACE_GEOMETRY_KIND,
  TRACKING_POINT_KIND,
} from "@openbeacon/encryption";
import {
  createPlaceSchema,
  placeEmojiSchema,
  placeNameSchema,
  updatePlaceSchema,
} from "./places.ts";

const geometry = {
  algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
  ciphertext: "ciphertext",
  epochId: "epoch-1",
  kind: PLACE_GEOMETRY_KIND,
  nonce: Buffer.alloc(24, 1).toString("base64"),
  senderDeviceId: "device-1",
};

describe("placeEmojiSchema", () => {
  test("accepts one emoji, including modifiers, flags, keycaps and joined sequences", () => {
    for (const emoji of ["🏠", "🏫", "❤️", "👍🏽", "🇬🇧", "1️⃣", "👨‍👩‍👧", "🏳️‍🌈", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"]) {
      expect(placeEmojiSchema.safeParse(emoji).success).toBe(true);
    }
  });

  test("rejects text, empty values and more than one emoji", () => {
    for (const emoji of ["", "A", "Home", "🏠🏫", "🏠 ", " 🏠", "🇬", "1", "🏠a"]) {
      expect(placeEmojiSchema.safeParse(emoji).success).toBe(false);
    }
  });
});

describe("placeNameSchema", () => {
  test("trims names and limits them to 50 characters", () => {
    expect(placeNameSchema.parse("  Home ")).toBe("Home");
    expect(placeNameSchema.safeParse("a".repeat(50)).success).toBe(true);
    expect(placeNameSchema.safeParse("a".repeat(51)).success).toBe(false);
    expect(placeNameSchema.safeParse("   ").success).toBe(false);
  });

  test("rejects control characters", () => {
    expect(placeNameSchema.safeParse("Home\nSchool").success).toBe(false);
  });
});

describe("place input schemas", () => {
  test("only accept the place geometry kind", () => {
    const input = { groupId: "group-1", name: "Home", emoji: "🏠", geometry };
    expect(createPlaceSchema.safeParse(input).success).toBe(true);
    expect(
      createPlaceSchema.safeParse({
        ...input,
        geometry: { ...geometry, kind: TRACKING_POINT_KIND },
      }).success,
    ).toBe(false);
  });

  test("drop plain-text coordinates sent alongside the encrypted geometry", () => {
    const parsed = createPlaceSchema.parse({
      groupId: "group-1",
      name: "Home",
      emoji: "🏠",
      geometry: { ...geometry, latitude: 51.5, longitude: -0.12, radiusMeters: 150 },
      latitude: 51.5,
    });
    expect(JSON.stringify(parsed)).not.toContain("51.5");
  });

  test("limit the ciphertext size and require a valid nonce", () => {
    const input = { groupId: "group-1", name: "Home", emoji: "🏠", geometry };
    expect(
      createPlaceSchema.safeParse({
        ...input,
        geometry: { ...geometry, ciphertext: "a".repeat(513) },
      }).success,
    ).toBe(false);
    expect(
      createPlaceSchema.safeParse({ ...input, geometry: { ...geometry, nonce: "short" } }).success,
    ).toBe(false);
  });

  test("updates need the ciphertext the phone last saw", () => {
    const input = { groupId: "group-1", placeId: "place-1", name: "Home", emoji: "🏠", geometry };
    expect(updatePlaceSchema.safeParse(input).success).toBe(false);
    expect(updatePlaceSchema.safeParse({ ...input, expectedCiphertext: "old" }).success).toBe(true);
  });
});
