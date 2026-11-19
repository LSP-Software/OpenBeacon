import { describe, expect, test } from "bun:test";
import { currentSeats, seatsEnforced } from "./seats.ts";

const endedAt = new Date("2026-11-18T12:00:00Z");

test("only hosted servers enforce seats", () => {
  expect(seatsEnforced({ selfHosted: true })).toBe(false);
  expect(seatsEnforced({ selfHosted: false })).toBe(true);
});

describe("currentSeats", () => {
  test("an account with no paid period end, or one still running, keeps its seats", () => {
    expect(currentSeats({ seats: 4, paidPeriodEndsAt: null }, endedAt)).toBe(4);
    expect(
      currentSeats({ seats: 4, paidPeriodEndsAt: endedAt }, new Date(endedAt.getTime() - 1)),
    ).toBe(4);
  });

  test("has no seats from the moment the paid period ends", () => {
    expect(currentSeats({ seats: 4, paidPeriodEndsAt: endedAt }, endedAt)).toBe(0);
    expect(
      currentSeats({ seats: 4, paidPeriodEndsAt: endedAt }, new Date(endedAt.getTime() + 1)),
    ).toBe(0);
  });
});
