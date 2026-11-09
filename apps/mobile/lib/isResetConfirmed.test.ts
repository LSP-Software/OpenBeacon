import { describe, expect, test } from "bun:test";
import { isResetConfirmed } from "./isResetConfirmed.ts";

describe("isResetConfirmed", () => {
  test("accepts RESET, ignoring surrounding spaces", () => {
    expect(isResetConfirmed("RESET")).toBe(true);
    expect(isResetConfirmed("  RESET ")).toBe(true);
  });

  test.each(["", " ", "reset", "Reset", "RESET!", "RESETS", "RE SET", "R", "yes"])(
    "rejects %p",
    (confirmation) => {
      expect(isResetConfirmed(confirmation)).toBe(false);
    },
  );
});
