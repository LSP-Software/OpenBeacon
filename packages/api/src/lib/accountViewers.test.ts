import { describe, expect, test } from "bun:test";
import { GroupEventType } from "@openbeacon/database";
import { groupNameAt, pastViewers } from "./accountViewers.ts";

const at = (day: number) => new Date(Date.UTC(2026, 10, day));

const event = (
  id: string,
  type: GroupEventType,
  memberUserId: string | null,
  day: number,
  groupId = "family",
) => ({ id, groupId, type, memberUserId, createdAt: at(day) });

describe("pastViewers", () => {
  test("lists someone who left while you stayed", () => {
    expect(
      pastViewers({
        userId: "me",
        currentMembers: [{ groupId: "family", userId: "me", since: at(1) }],
        events: [
          event("1", GroupEventType.MEMBER_JOINED, "alex", 3),
          event("2", GroupEventType.MEMBER_LEFT, "alex", 5),
        ],
      }),
    ).toEqual([{ groupId: "family", userId: "alex", from: at(3), to: at(5), reason: "theyLeft" }]);
  });

  test("starts at your join when they were there first and ends when you are removed", () => {
    expect(
      pastViewers({
        userId: "me",
        currentMembers: [{ groupId: "family", userId: "alex", since: at(1) }],
        events: [
          event("1", GroupEventType.MEMBER_JOINED, "me", 4),
          event("2", GroupEventType.MEMBER_REMOVED, "me", 6),
        ],
      }),
    ).toEqual([
      { groupId: "family", userId: "alex", from: at(4), to: at(6), reason: "youWereRemoved" },
    ]);
  });

  test("leaves the start unknown when the join is older than the events", () => {
    expect(
      pastViewers({
        userId: "me",
        currentMembers: [{ groupId: "family", userId: "me", since: at(1) }],
        events: [event("1", GroupEventType.MEMBER_REMOVED, "alex", 5)],
      }),
    ).toEqual([
      { groupId: "family", userId: "alex", from: null, to: at(5), reason: "theyWereRemoved" },
    ]);
    expect(
      pastViewers({
        userId: "me",
        currentMembers: [],
        events: [
          event("1", GroupEventType.MEMBER_LEFT, "alex", 5),
          event("2", GroupEventType.MEMBER_LEFT, "me", 6),
        ],
      }),
    ).toEqual([{ groupId: "family", userId: "alex", from: null, to: at(5), reason: "theyLeft" }]);
  });

  test("ignores people who were only in the group while you were not", () => {
    expect(
      pastViewers({
        userId: "me",
        currentMembers: [{ groupId: "family", userId: "me", since: at(7) }],
        events: [
          event("1", GroupEventType.MEMBER_LEFT, "me", 2),
          event("2", GroupEventType.MEMBER_JOINED, "alex", 3),
          event("3", GroupEventType.MEMBER_LEFT, "alex", 5),
          event("4", GroupEventType.MEMBER_JOINED, "me", 7),
        ],
      }),
    ).toEqual([]);
  });

  test("does not list people who can still see you in that group", () => {
    expect(
      pastViewers({
        userId: "me",
        currentMembers: [
          { groupId: "family", userId: "me", since: at(1) },
          { groupId: "family", userId: "alex", since: at(2) },
        ],
        events: [event("1", GroupEventType.MEMBER_JOINED, "alex", 2)],
      }),
    ).toEqual([]);
  });

  test("lists each stretch separately when someone rejoins, newest first", () => {
    expect(
      pastViewers({
        userId: "me",
        currentMembers: [{ groupId: "family", userId: "me", since: at(1) }],
        events: [
          event("1", GroupEventType.MEMBER_JOINED, "alex", 2),
          event("2", GroupEventType.MEMBER_LEFT, "alex", 3),
          event("3", GroupEventType.MEMBER_JOINED, "alex", 4),
          event("4", GroupEventType.MEMBER_REMOVED, "alex", 6),
        ],
      }),
    ).toEqual([
      { groupId: "family", userId: "alex", from: at(4), to: at(6), reason: "theyWereRemoved" },
      { groupId: "family", userId: "alex", from: at(2), to: at(3), reason: "theyLeft" },
    ]);
  });

  test("ends when you leave and keeps groups apart", () => {
    expect(
      pastViewers({
        userId: "me",
        currentMembers: [
          { groupId: "family", userId: "alex", since: at(1) },
          { groupId: "work", userId: "me", since: at(1) },
          { groupId: "work", userId: "sam", since: at(1) },
        ],
        events: [
          event("1", GroupEventType.GROUP_CREATED, "me", 2),
          event("2", GroupEventType.MEMBER_LEFT, "me", 5),
          event("3", GroupEventType.MEMBER_LEFT, "sam", 4, "elsewhere"),
        ],
      }),
    ).toEqual([{ groupId: "family", userId: "alex", from: at(2), to: at(5), reason: "youLeft" }]);
  });

  test("skips events whose account was deleted", () => {
    expect(
      pastViewers({
        userId: "me",
        currentMembers: [{ groupId: "family", userId: "me", since: at(1) }],
        events: [
          event("1", GroupEventType.MEMBER_JOINED, null, 2),
          event("2", GroupEventType.ACCOUNT_DELETED, null, 3),
        ],
      }),
    ).toEqual([]);
  });
});

describe("groupNameAt", () => {
  const renames = [
    { createdAt: at(6), previousName: "Second" },
    { createdAt: at(3), previousName: "First" },
  ];

  test("uses the name from before the first rename after that time", () => {
    expect(groupNameAt({ at: at(2), currentName: "Third", renames })).toBe("First");
    expect(groupNameAt({ at: at(4), currentName: "Third", renames })).toBe("Second");
  });

  test("uses the current name when nothing was renamed later", () => {
    expect(groupNameAt({ at: at(6), currentName: "Third", renames })).toBe("Third");
    expect(groupNameAt({ at: at(2), currentName: "Third", renames: [] })).toBe("Third");
  });
});
