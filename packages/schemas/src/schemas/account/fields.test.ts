import { describe, expect, test } from "bun:test";
import { accountNameSchema } from "./fields.ts";

describe("accountNameSchema", () => {
  test("trims names and accepts international names and punctuation", () => {
    expect(accountNameSchema.parse("  李 O’Connor  ")).toBe("李 O’Connor");
  });

  test("rejects blank, excessively long, and control character names", () => {
    for (const name of ["   ", "a".repeat(101), "Alice\nBob", "A\u0000B"]) {
      expect(accountNameSchema.safeParse(name).success).toBe(false);
    }
  });
});
