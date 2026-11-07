import { describe, expect, test } from "bun:test";
import { accountNameSchema, emailSchema } from "./fields.ts";

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

describe("emailSchema", () => {
  test("trims and lowercases emails before validating them", () => {
    expect(emailSchema.parse("  Alice@Example.COM  ")).toBe("alice@example.com");
  });

  test("rejects blank and malformed emails", () => {
    for (const email of [
      "",
      "   ",
      "alice",
      "alice@",
      "alice @example.com",
      `${"a".repeat(309)}@example.com`,
    ]) {
      expect(emailSchema.safeParse(email).success).toBe(false);
    }
  });
});
