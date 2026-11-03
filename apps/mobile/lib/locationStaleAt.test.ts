import { describe, expect, test } from "bun:test";
import { locationStaleAt } from "./locationStaleAt.ts";

describe("locationStaleAt", () => {
  test("marks a location stale only after 10 minutes", () => {
    const timestamp = "2026-07-19T12:00:00.000Z";
    const staleAt = locationStaleAt(timestamp);

    expect(Date.parse("2026-07-19T12:10:00.000Z") >= staleAt).toBe(false);
    expect(Date.parse("2026-07-19T12:10:00.001Z") >= staleAt).toBe(true);
  });
});
