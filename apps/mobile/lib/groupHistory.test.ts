import { beforeEach, describe, expect, mock, test } from "bun:test";

const values = new Map<string, number>();

mock.module("react-native-mmkv", () => ({
  createMMKV: () => ({
    getNumber: (key: string) => values.get(key),
    set: (key: string, value: number) => {
      values.set(key, value);
    },
  }),
}));

const { describeGroupEvent, groupByDay, hasUnseenGroupHistory, markGroupHistorySeen } =
  await import("./groupHistory.ts");

type GroupEvent = Parameters<typeof describeGroupEvent>[0]["event"];

const sam = { userId: "sam", name: "Sam King" };
const alex = { userId: "alex", name: "Alex" };
const me = { userId: "me", name: "Me" };

const event = (fields: Partial<GroupEvent> & Pick<GroupEvent, "type">): GroupEvent => ({
  kind: "group",
  id: "event",
  at: new Date(),
  role: null,
  name: null,
  previousName: null,
  emoji: null,
  actor: null,
  subject: null,
  ...fields,
});

const describe_ = (fields: Partial<GroupEvent> & Pick<GroupEvent, "type">) =>
  describeGroupEvent({
    event: event(fields),
    memberName: (userId) => (userId === "sam" ? "Dad" : null),
    userId: "me",
  });

describe("group event wording", () => {
  test("uses private nicknames, then account names, and says you for this account", () => {
    expect(describe_({ type: "MEMBER_REMOVED", actor: sam, subject: alex })).toBe(
      "Dad removed Alex",
    );
    expect(describe_({ type: "ROLE_CHANGED", actor: sam, subject: me, role: "ADMIN" })).toBe(
      "Dad made you an admin",
    );
  });

  test("an event type this build doesn't know has no wording", () => {
    expect(describe_({ type: "SEATS_CHANGED" as GroupEvent["type"], actor: sam })).toBeNull();
  });

  test("describes role changes, including demotions and people changing their own role", () => {
    expect(describe_({ type: "ROLE_CHANGED", actor: sam, subject: alex, role: "OWNER" })).toBe(
      "Dad made Alex an owner",
    );
    expect(describe_({ type: "ROLE_CHANGED", actor: me, subject: alex, role: "MEMBER" })).toBe(
      "You changed Alex’s role to member",
    );
    expect(describe_({ type: "ROLE_CHANGED", actor: sam, subject: me, role: "MEMBER" })).toBe(
      "Dad changed your role to member",
    );
    expect(describe_({ type: "ROLE_CHANGED", actor: sam, subject: null, role: "MEMBER" })).toBe(
      "Dad changed a deleted account’s role to member",
    );
    expect(describe_({ type: "ROLE_CHANGED", actor: me, subject: me, role: "ADMIN" })).toBe(
      "You became an admin",
    );
    expect(describe_({ type: "ROLE_CHANGED", actor: sam, subject: sam, role: "OWNER" })).toBe(
      "Dad became an owner",
    );
  });

  test("names a deleted account without its old name", () => {
    expect(describe_({ type: "MEMBER_REMOVED", actor: null, subject: alex })).toBe(
      "A deleted account removed Alex",
    );
    expect(describe_({ type: "ROLE_CHANGED", actor: sam, subject: null, role: "OWNER" })).toBe(
      "Dad made a deleted account an owner",
    );
    expect(describe_({ type: "ACCOUNT_DELETED" })).toBe("A member deleted their account");
  });

  test("describes joins, leaves, renames and places", () => {
    expect(describe_({ type: "MEMBER_JOINED", subject: alex, role: "MEMBER" })).toBe("Alex joined");
    expect(describe_({ type: "MEMBER_JOINED", subject: alex, role: "ADMIN" })).toBe(
      "Alex joined as an admin",
    );
    expect(describe_({ type: "MEMBER_LEFT", subject: me })).toBe("You left the group");
    expect(
      describe_({ type: "GROUP_RENAMED", actor: alex, name: "Kings", previousName: "Family" }),
    ).toBe("Alex renamed the group from “Family” to “Kings”");
    expect(describe_({ type: "GROUP_RENAMED", actor: alex, name: "Kings" })).toBe(
      "Alex renamed the group to “Kings”",
    );
    expect(describe_({ type: "GROUP_RENAMED", actor: alex, previousName: "Family" })).toBe(
      "Alex renamed the group",
    );
    expect(describe_({ type: "GROUP_IMAGE_CHANGED", actor: alex })).toBe(
      "Alex changed the group picture",
    );
    expect(describe_({ type: "PLACE_ADDED", actor: sam, name: "Home", emoji: "🏠" })).toBe(
      "Dad added 🏠 Home",
    );
    expect(
      describe_({
        type: "PLACE_UPDATED",
        actor: sam,
        name: "Gran's",
        emoji: "👵",
        previousName: "Home",
      }),
    ).toBe("Dad renamed “Home” to “Gran's”");
    expect(describe_({ type: "PLACE_UPDATED", actor: sam, name: "Home", emoji: "🏠" })).toBe(
      "Dad edited 🏠 Home",
    );
    expect(describe_({ type: "PLACE_DELETED", actor: sam, name: "Home", emoji: "🏠" })).toBe(
      "Dad deleted 🏠 Home",
    );
  });
});

describe("history by day", () => {
  test("splits newest-first items into Today, Yesterday and older days", () => {
    const now = new Date(2026, 10, 15, 18, 0);
    const sections = groupByDay({
      items: [
        { id: "a", at: new Date(2026, 10, 15, 17, 42) },
        { id: "b", at: new Date(2026, 10, 15, 0, 1) },
        { id: "c", at: new Date(2026, 10, 14, 23, 59) },
        { id: "d", at: new Date(2026, 10, 12, 9, 0) },
      ],
      now,
    });
    expect(sections.map((section) => section.title.slice(0, 9))).toEqual([
      "Today",
      "Yesterday",
      expect.not.stringMatching(/Today|Yesterday/),
    ]);
    expect(sections.map((section) => section.items.map((item) => item.id))).toEqual([
      ["a", "b"],
      ["c"],
      ["d"],
    ]);
  });

  test("treats yesterday across a month boundary", () => {
    const sections = groupByDay({
      items: [{ at: new Date(2026, 10, 30, 22, 0) }],
      now: new Date(2026, 11, 1, 8, 0),
    });
    expect(sections[0]?.title).toBe("Yesterday");
  });
});

describe("unseen history", () => {
  beforeEach(() => values.clear());

  test("is unseen until viewed, and only newer activity makes it unseen again", () => {
    const at = new Date(2026, 10, 16, 9, 0);
    const later = new Date(at.getTime() + 1_000);
    const seen = { groupId: "family", userId: "me" };
    expect(hasUnseenGroupHistory({ ...seen, latestAt: null })).toBe(false);
    expect(hasUnseenGroupHistory({ ...seen, latestAt: at })).toBe(true);

    markGroupHistorySeen({ ...seen, latestAt: at });
    expect(hasUnseenGroupHistory({ ...seen, latestAt: at })).toBe(false);
    expect(hasUnseenGroupHistory({ ...seen, latestAt: later })).toBe(true);

    markGroupHistorySeen({ ...seen, latestAt: later });
    markGroupHistorySeen({ ...seen, latestAt: at });
    expect(hasUnseenGroupHistory({ ...seen, latestAt: later })).toBe(false);
  });

  test("keeps each account's and group's seen time apart", () => {
    const at = new Date(2026, 10, 16, 9, 0);
    markGroupHistorySeen({ groupId: "family", userId: "me", latestAt: at });
    expect(hasUnseenGroupHistory({ groupId: "friends", userId: "me", latestAt: at })).toBe(true);
    expect(hasUnseenGroupHistory({ groupId: "family", userId: "other", latestAt: at })).toBe(true);
  });
});
