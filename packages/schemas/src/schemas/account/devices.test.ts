import { describe, expect, test } from "bun:test";
import { deviceIconSchema, deviceNameSchema } from "./devices.ts";

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
