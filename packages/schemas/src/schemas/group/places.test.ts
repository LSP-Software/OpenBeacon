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
  reEncryptPlacesSchema,
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

  test("rejects bidi and invisible format characters", () => {
    for (const name of ["Ho\u202Eme", "Ho\u200Bme", "\u2066Home\u2069", "Ho\uFEFFme"]) {
      expect(placeNameSchema.safeParse(name).success).toBe(false);
    }
  });

  test("rejects names made only of zero-width characters", () => {
    for (const name of ["\u200B", "\u200D", "\u200D\u200D", "\u200B\u200C\u200D", "\uFE0F"]) {
      expect(placeNameSchema.safeParse(name).success).toBe(false);
    }
  });

  test("keeps emoji joined with zero-width joiners", () => {
    expect(placeNameSchema.safeParse("\u{1F468}\u200D\u{1F469}\u200D\u{1F467} home").success).toBe(
      true,
    );
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

  test("re-encrypting takes a batch of distinct places", () => {
    const place = {
      placeId: "place-1",
      name: "Home",
      emoji: "🏠",
      expectedCiphertext: "old",
      geometry,
    };
    expect(reEncryptPlacesSchema.safeParse({ groupId: "group-1", places: [place] }).success).toBe(
      true,
    );
    expect(reEncryptPlacesSchema.safeParse({ groupId: "group-1", places: [] }).success).toBe(false);
    expect(
      reEncryptPlacesSchema.safeParse({ groupId: "group-1", places: [place, place] }).success,
    ).toBe(false);
    const { expectedCiphertext: _, ...withoutExpected } = place;
    expect(
      reEncryptPlacesSchema.safeParse({ groupId: "group-1", places: [withoutExpected] }).success,
    ).toBe(false);
  });
});
