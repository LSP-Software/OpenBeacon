import { describe, expect, test } from "bun:test";
import { approveDeviceLinkSchema, deviceIconSchema, deviceNameSchema } from "./devices.ts";

describe("deviceNameSchema", () => {
  test("trims names", () => {
    expect(deviceNameSchema.parse("  Sam’s iPad  ")).toBe("Sam’s iPad");
  });

  test("accepts 40 characters after trimming", () => {
    expect(deviceNameSchema.parse(` ${"a".repeat(40)} `)).toBe("a".repeat(40));
  });

  test("rejects blank, long and control character names", () => {
    for (const name of ["", "   ", "a".repeat(41), "Car\nKeys", "A\u0000B"]) {
      expect(deviceNameSchema.safeParse(name).success).toBe(false);
    }
  });
  test("rejects invisible format characters that could disguise another phone's name", () => {
    for (const name of [
      "Sam\u202Es iPhone",
      "Sam\u200B's iPhone",
      "\u2066Phone\u2069",
      "Pho\uFEFFne",
    ]) {
      expect(deviceNameSchema.safeParse(name).success).toBe(false);
    }
  });

  test("keeps emoji joined with zero-width joiners", () => {
    expect(deviceNameSchema.safeParse("\u{1F468}\u200D\u{1F469}\u200D\u{1F467} iPad").success).toBe(
      true,
    );
  });
});

describe("deviceIconSchema", () => {
  test("only accepts the fixed icons", () => {
    expect(deviceIconSchema.options).toEqual([
      "phone",
      "tablet",
      "watch",
      "car",
      "laptop",
      "bag",
      "tag",
      "home",
    ]);
    expect(deviceIconSchema.safeParse("rocket").success).toBe(false);
  });
});

describe("approveDeviceLinkSchema", () => {
  const approval = {
    linkId: crypto.randomUUID(),
    enc: Buffer.alloc(32, 7).toString("base64"),
    ciphertext: "AAAA",
  };

  test("accepts a 32-byte encapsulated key", () => {
    expect(approveDeviceLinkSchema.safeParse(approval).success).toBe(true);
  });

  test("rejects an empty or wrongly sized encapsulated key", () => {
    for (const enc of [
      "",
      Buffer.alloc(31).toString("base64"),
      Buffer.alloc(33).toString("base64"),
    ]) {
      expect(approveDeviceLinkSchema.safeParse({ ...approval, enc }).success).toBe(false);
    }
  });
});
