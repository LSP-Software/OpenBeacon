import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { validateEnv } from "./validateEnv.ts";

const longString = {
  safeParse: (value: unknown) =>
    typeof value === "string" && value.length >= 8
      ? { success: true as const }
      : { success: false as const, error: { issues: [{ message: "Too short" }] } },
};
const optional = {
  safeParse: (value: unknown) =>
    value === undefined || (typeof value === "string" && value.length >= 8)
      ? { success: true as const }
      : { success: false as const, error: { issues: [{ message: "Too short" }] } },
};

const capture = () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  return {
    stdout: () => log.mock.calls.map((call) => String(call[0])),
    stderr: () => error.mock.calls.map((call) => String(call[0])),
  };
};

afterEach(() => {
  spyOn(console, "log").mockRestore();
  spyOn(console, "error").mockRestore();
});

describe("validateEnv", () => {
  test("lists each variable without printing its value", () => {
    const output = capture();
    validateEnv({
      schemas: { SECRET: longString, OPTIONAL: optional },
      source: { SECRET: "super-secret-value" },
    });
    expect(output.stdout()).toEqual([
      "Environment configuration:",
      "  SECRET: valid",
      "  OPTIONAL: not set (optional/default)",
      "Environment configuration valid",
    ]);
    expect(output.stdout().join("\n")).not.toContain("super-secret-value");
  });

  test("reports every invalid variable and failed check before failing", () => {
    const output = capture();
    expect(() =>
      validateEnv({
        schemas: { SECRET: longString, OTHER: longString },
        source: { SECRET: "abc123", OTHER: "" },
        checks: [() => null, () => "PAIR: both are required"],
      }),
    ).toThrow("Environment configuration validation failed");
    expect(output.stderr()).toEqual([
      "  SECRET: invalid (Too short)",
      "  OTHER: invalid (Too short)",
      "  PAIR: both are required",
    ]);
    expect(output.stderr().join("\n")).not.toContain("abc123");
  });
});
