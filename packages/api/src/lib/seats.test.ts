import { describe, expect, test } from "bun:test";
import { seatPeriod, seatsEnforced } from "./seats.ts";

const endedAt = new Date("2026-11-18T12:00:00Z");
const hours = (count: number) => new Date(endedAt.getTime() + count * 3_600_000);

test("only hosted servers enforce seats", () => {
  expect(seatsEnforced({ selfHosted: true })).toBe(false);
  expect(seatsEnforced({ selfHosted: false })).toBe(true);
});

describe("seatPeriod", () => {
  test("an account with no paid period end, or one still running, keeps its seats", () => {
    const account = { seats: 4, paidPeriodEndsAt: null, lastGracePeriodStartedAt: null };
    expect(seatPeriod(account, endedAt)).toEqual({ seats: 4, grace: null });
    expect(seatPeriod({ ...account, paidPeriodEndsAt: endedAt }, hours(-1))).toEqual({
      seats: 4,
      grace: null,
    });
  });

  test("keeps the seats for 7 days after the paid period ends, then has none", () => {
    const account = { seats: 4, paidPeriodEndsAt: endedAt, lastGracePeriodStartedAt: null };
    const grace = { startedAt: endedAt, endsAt: hours(7 * 24) };
    expect(seatPeriod(account, endedAt)).toEqual({ seats: 4, grace });
    expect(seatPeriod(account, hours(7 * 24 - 1))).toEqual({ seats: 4, grace });
    expect(seatPeriod(account, hours(7 * 24))).toEqual({ seats: 0, grace: null });
  });

  test("a grace period already recorded for this paid period still counts", () => {
    expect(
      seatPeriod(
        { seats: 4, paidPeriodEndsAt: endedAt, lastGracePeriodStartedAt: endedAt },
        hours(24),
      ).seats,
    ).toBe(4);
  });

  test("gives no second grace period within 6 months", () => {
    const fiveMonthsBefore = new Date("2026-06-18T12:00:00Z");
    expect(
      seatPeriod(
        { seats: 4, paidPeriodEndsAt: endedAt, lastGracePeriodStartedAt: fiveMonthsBefore },
        endedAt,
      ),
    ).toEqual({ seats: 0, grace: null });
    const sixMonthsBefore = new Date("2026-05-18T12:00:00Z");
    expect(
      seatPeriod(
        { seats: 4, paidPeriodEndsAt: endedAt, lastGracePeriodStartedAt: sixMonthsBefore },
        endedAt,
      ).seats,
    ).toBe(4);
  });

  test("counts 6 months back to the same time of day, or the end of a shorter month", () => {
    const given = (paidPeriodEndsAt: Date, lastGracePeriodStartedAt: Date) =>
      seatPeriod({ seats: 4, paidPeriodEndsAt, lastGracePeriodStartedAt }, paidPeriodEndsAt)
        .grace !== null;
    const exactly = new Date("2026-05-18T12:00:00Z");
    expect(given(endedAt, exactly)).toBe(true);
    expect(given(endedAt, new Date(exactly.getTime() + 1))).toBe(false);
    const monthEnd = new Date("2026-08-31T12:00:00Z");
    expect(given(monthEnd, new Date("2026-02-28T12:00:00Z"))).toBe(true);
    expect(given(monthEnd, new Date("2026-02-28T12:00:00.001Z"))).toBe(false);
    expect(given(monthEnd, new Date("2026-03-01T12:00:00Z"))).toBe(false);
    expect(given(new Date("2028-08-31T12:00:00Z"), new Date("2028-02-29T12:00:00Z"))).toBe(true);
  });
});
