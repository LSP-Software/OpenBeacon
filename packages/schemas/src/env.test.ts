import { describe, expect, test } from "bun:test";
import { optionalEnvString, serverNameSchema } from "./env.ts";

describe("optionalEnvString", () => {
  test("returns undefined when the input is undefined", () => {
    expect(optionalEnvString.parse(undefined)).toBeUndefined();
  });

  test("converts an empty string to undefined", () => {
    expect(optionalEnvString.parse("")).toBeUndefined();
  });

  test("accepts a non-empty trimmed string", () => {
    expect(optionalEnvString.parse(" value ")).toBe("value");
  });

  test("converts whitespace-only strings to undefined", () => {
    expect(optionalEnvString.parse("   ")).toBeUndefined();
  });

  test("leaves non-string values to zod validation", () => {
    expect(() => optionalEnvString.parse(123)).toThrow();
  });
});

describe("serverNameSchema", () => {
  test("uses the default for a missing or blank name", () => {
    expect(serverNameSchema.parse(undefined)).toBe("OpenBeacon");
    expect(serverNameSchema.parse("")).toBe("OpenBeacon");
    expect(serverNameSchema.parse("   ")).toBe("OpenBeacon");
    expect(serverNameSchema.parse(" Family server ")).toBe("Family server");
  });

  test("refuses a name too long to show in the app and email footers", () => {
    expect(serverNameSchema.safeParse("a".repeat(100)).success).toBe(true);
    expect(serverNameSchema.safeParse("a".repeat(101)).success).toBe(false);
  });
});
