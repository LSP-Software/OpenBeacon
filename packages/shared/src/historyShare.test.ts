import { describe, expect, test } from "bun:test";
import {
  HISTORY_SHARES,
  historyShareFirstHour,
  isShorterHistoryShare,
  resolveHistoryShare,
} from "./historyShare.ts";

describe("resolveHistoryShare", () => {
  test("a group override beats the account setting", () => {
    expect(resolveHistoryShare({ account: "MAXIMUM", group: "HOURS_6" })).toBe("HOURS_6");
    expect(resolveHistoryShare({ account: "LAST_LOCATION", group: "WEEK_1" })).toBe("WEEK_1");
  });

  test("no override uses the account setting", () => {
    for (const account of HISTORY_SHARES) {
      expect(resolveHistoryShare({ account, group: null })).toBe(account);
    }
  });
});

describe("historyShareFirstHour", () => {
  test("keeps only whole hours inside the window, counting the current hour", () => {
    expect(historyShareFirstHour("HOURS_6", 1_000)).toBe(995);
    expect(historyShareFirstHour("DAY_1", 1_000)).toBe(977);
    expect(historyShareFirstHour("WEEK_1", 1_000)).toBe(833);
  });

  test("last location only starts after the current hour, so no history is inside it", () => {
    expect(historyShareFirstHour("LAST_LOCATION", 1_000)).toBe(1_001);
  });

  test("maximum has no limit of its own", () => {
    expect(historyShareFirstHour("MAXIMUM", 1_000)).toBeNull();
  });
});

test("isShorterHistoryShare orders the choices from last location to maximum", () => {
  expect(isShorterHistoryShare("HOURS_6", "MAXIMUM")).toBe(true);
  expect(isShorterHistoryShare("LAST_LOCATION", "HOURS_6")).toBe(true);
  expect(isShorterHistoryShare("WEEK_1", "DAY_1")).toBe(false);
  expect(isShorterHistoryShare("DAY_1", "DAY_1")).toBe(false);
});
