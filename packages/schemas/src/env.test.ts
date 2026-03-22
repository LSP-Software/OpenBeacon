import { describe, expect, test } from "bun:test";
import { optionalEnvString } from "./env.ts";

describe("optionalEnvString", () => {
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
