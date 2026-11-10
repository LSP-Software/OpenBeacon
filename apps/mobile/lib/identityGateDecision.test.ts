import { describe, expect, test } from "bun:test";
import { identityGateDecision } from "./identityGateDecision.ts";

describe("identityGateDecision", () => {
  test("skips confirming when the session stays fresh long enough to finish", () => {
    expect(identityGateDecision({ freshForMs: 15 * 60_000, sessionFresh: true })).toBe("ready");
    expect(identityGateDecision({ freshForMs: 10 * 60_000, sessionFresh: true })).toBe("ready");
  });

  test("asks to confirm when the session goes stale within 10 minutes", () => {
    expect(identityGateDecision({ freshForMs: 10 * 60_000 - 1, sessionFresh: true })).toBe(
      "confirm",
    );
    expect(identityGateDecision({ freshForMs: 5_000, sessionFresh: true })).toBe("confirm");
  });

  test("asks to confirm when the session is already stale", () => {
    expect(identityGateDecision({ freshForMs: 0, sessionFresh: false })).toBe("confirm");
  });

  test("asks to confirm when the status could not be fetched", () => {
    expect(identityGateDecision(undefined)).toBe("confirm");
  });

  test("skips confirming when the server never expires freshness", () => {
    expect(identityGateDecision({ freshForMs: null, sessionFresh: true })).toBe("ready");
  });
});
