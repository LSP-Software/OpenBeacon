import { describe, expect, test } from "bun:test";
import {
  groupHistoryShare,
  historyShareAmount,
  historyShareLabel,
  historyShareNote,
  senderHistoryStart,
  shortensHistory,
} from "./historyShare.ts";

const setting = {
  account: "WEEK_1" as const,
  groups: [
    { groupId: "family", historyShare: null },
    { groupId: "club", historyShare: "HOURS_6" as const },
  ],
};

describe("groupHistoryShare", () => {
  test("a group's own choice beats the account setting", () => {
    expect(groupHistoryShare(setting, "club")).toEqual({ override: "HOURS_6", share: "HOURS_6" });
    expect(groupHistoryShare(setting, "family")).toEqual({ override: null, share: "WEEK_1" });
  });
});

describe("shortensHistory", () => {
  const groupIds = ["family", "club"];

  test("a shorter account setting shortens only groups that follow it", () => {
    expect(shortensHistory({ groupIds, next: { account: "DAY_1" }, setting })).toBe(true);
    expect(
      shortensHistory({
        groupIds: ["club"],
        next: { account: "DAY_1" },
        setting,
      }),
    ).toBe(false);
  });

  test("lengthening never asks to delete", () => {
    expect(shortensHistory({ groupIds, next: { account: "MAXIMUM" }, setting })).toBe(false);
    expect(
      shortensHistory({ groupIds, next: { groupId: "club", override: "DAY_1" }, setting }),
    ).toBe(false);
  });

  test("clearing a group's choice shortens it when the account setting is shorter", () => {
    const longGroup = {
      account: "HOURS_6" as const,
      groups: [{ groupId: "club", historyShare: "MAXIMUM" as const }],
    };
    expect(
      shortensHistory({
        groupIds: ["club"],
        next: { groupId: "club", override: null },
        setting: longGroup,
      }),
    ).toBe(true);
  });

  test("last location only shortens any window", () => {
    expect(
      shortensHistory({ groupIds, next: { groupId: "club", override: "LAST_LOCATION" }, setting }),
    ).toBe(true);
  });

  test("moving off a setting this build doesn't know always asks before deleting", () => {
    const unknown = {
      account: "DAYS_3" as typeof setting.account,
      groups: [{ groupId: "family", historyShare: null }],
    };
    for (const share of ["HOURS_6", "LAST_LOCATION", "MAXIMUM"] as const) {
      expect(
        shortensHistory({ groupIds: ["family"], next: { account: share }, setting: unknown }),
      ).toBe(true);
    }
  });
});

describe("wording", () => {
  test("notes name the window or say only the location now, and say nothing for the maximum", () => {
    expect(historyShareNote("Sam", "HOURS_6")).toBe("Sam shares the last 6 hours");
    expect(historyShareNote("Sam", "LAST_LOCATION")).toBe("Sam shares only their location now");
    expect(historyShareNote(null, "DAY_1")).toBe("You share the last day");
    expect(historyShareNote("Sam", "MAXIMUM")).toBeNull();
  });

  test("the invite line describes the amount shared", () => {
    expect(historyShareAmount("WEEK_1")).toBe("1 week of history");
    expect(historyShareAmount("MAXIMUM")).toBe("up to 14 days of history");
  });

  test("a setting this build doesn't know still has wording", () => {
    const unknown = "DAYS_3" as typeof setting.account;
    expect(historyShareLabel(unknown)).toBe("Custom");
    expect(historyShareAmount(unknown)).toBe("some of your history");
    expect(historyShareNote("Sam", unknown)).toBeNull();
  });
});

test("senderHistoryStart turns a sender's first hour into a time and leaves the maximum open", () => {
  const senders = [
    { userId: "sam", firstHour: 500_000 },
    { userId: "bea", firstHour: null },
  ];
  expect(senderHistoryStart(senders, "sam")).toBe(500_000 * 3_600_000);
  expect(senderHistoryStart(senders, "bea")).toBeNull();
  expect(senderHistoryStart(senders, "gone")).toBeNull();
});
