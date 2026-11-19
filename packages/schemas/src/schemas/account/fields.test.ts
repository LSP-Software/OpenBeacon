import { describe, expect, test } from "bun:test";
import {
  accountNameFromProfile,
  accountNameSchema,
  emailSchema,
  passwordSchema,
} from "./fields.ts";

describe("accountNameSchema", () => {
  test("trims names and accepts international names and punctuation", () => {
    expect(accountNameSchema.parse("  李 O’Connor  ")).toBe("李 O’Connor");
  });

  test("rejects blank, excessively long, and control character names", () => {
    for (const name of ["   ", "a".repeat(101), "Alice\nBob", "A\u0000B"]) {
      expect(accountNameSchema.safeParse(name).success).toBe(false);
    }
  });

  test("refuses direction overrides and isolates, and names with nothing visible", () => {
    for (const name of [
      "Alice\u202Eevil",
      "\u2066Bob\u2069",
      "\u202A\u202B\u202C\u202D",
      "\u200B",
      "\u200B\u200D\u2060",
    ]) {
      expect(accountNameSchema.safeParse(name).success).toBe(false);
    }
  });

  test("refuses hidden format characters inside a visible name, and names made only of blank letters", () => {
    for (const name of [
      "Fam\u200Bily",
      "Ali\u2060ce",
      "Bo\uFEFFb",
      "\u3164",
      "\u2800\u2800",
      "\u115F\u1160",
      "\uFFA0 \u3164",
    ]) {
      expect(accountNameSchema.safeParse(name).success).toBe(false);
    }
    expect(accountNameSchema.parse("\u3164Bob")).toBe("\u3164Bob");
  });

  test("keeps the joiners and marks Persian, Arabic and Hebrew names use", () => {
    for (const name of [
      "\u0645\u06CC\u200C\u062E\u0648\u0627\u0645",
      "\u05D3\u05E0\u05D4\u200F (Dana)",
      "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
    ]) {
      expect(accountNameSchema.parse(name)).toBe(name);
    }
  });
});

describe("accountNameFromProfile", () => {
  test("keeps a valid profile name", () => {
    expect(accountNameFromProfile("  Alice Smith ")).toBe("Alice Smith");
  });

  test("drops the characters names refuse and keeps the rest", () => {
    expect(accountNameFromProfile("\u2066Ali\u202Ece\n\u2069")).toBe("Alice");
  });

  test("cuts long names to 100 characters without splitting an emoji", () => {
    expect(accountNameFromProfile("a".repeat(150))).toBe("a".repeat(100));
    expect(accountNameFromProfile(`${"a".repeat(99)}\u{1F600}`)).toBe("a".repeat(99));
  });

  test("falls back to a neutral name when nothing visible is left", () => {
    for (const name of ["", "   ", "\u202E\u2066\u2069", "\u200B"]) {
      expect(accountNameFromProfile(name)).toBe("OpenBeacon user");
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
      `${"a".repeat(321 - "@example.com".length)}@example.com`,
    ]) {
      expect(emailSchema.safeParse(email).success).toBe(false);
    }
  });
});

describe("passwordSchema", () => {
  test("matches the server's 8 to 128 character limit", () => {
    expect(passwordSchema.safeParse("a".repeat(7)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(8)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(128)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });
});
