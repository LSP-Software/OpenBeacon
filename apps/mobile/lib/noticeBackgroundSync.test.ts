import { beforeEach, describe, expect, mock, test } from "bun:test";

const storageValues = new Map<string, string>();
const shown: {
  kind: string;
  title: string;
  body: string | null;
  groupName: string | null;
  url: string;
}[] = [];
let failNotices = false;

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    getNumber: () => undefined,
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));
mock.module("./currentServer.ts", () => ({ baseUrl: "https://api.example.test" }));
mock.module("./personalNicknames.ts", () => ({
  loadPersonalNicknames: async () => ({ "member-sam": { name: "Mum", ciphertext: "sealed" } }),
}));
mock.module("./notifications.ts", () => ({
  showEventNotice: async (notice: {
    kind: string;
    title: string;
    body: string | null;
    groupName: string | null;
    link: { url: string };
  }) => {
    if (failNotices) throw new Error("Notifications unavailable");
    shown.push({
      kind: notice.kind,
      title: notice.title,
      body: notice.body,
      groupName: notice.groupName,
      url: notice.link.url,
    });
    return true;
  },
}));

const {
  describeAccountNotice,
  getAccountNoticesCursor,
  getNoticesCursor,
  showAccountNotices,
  showNotices,
} = await import("./noticeBackgroundSync.ts");

const at = new Date("2026-11-17T10:00:00.000Z");
const account = (
  type: Parameters<typeof describeAccountNotice>[0]["type"],
  extra: Partial<Parameters<typeof describeAccountNotice>[0]> = {},
) => ({
  kind: "account" as const,
  id: `notice-${type}`,
  at,
  type,
  device: null,
  deletionDate: null,
  holdsFrom: null,
  turnedOff: [],
  group: null,
  ...extra,
});

const groupEvent = (
  extra: Partial<{
    type: "MEMBER_JOINED" | "MEMBER_LEFT" | "ROLE_CHANGED";
    actor: { userId: string; name: string } | null;
    subject: { userId: string; name: string } | null;
    role: "ADMIN" | "EDITOR" | "MEMBER" | null;
    groupId: string;
  }>,
) => ({
  kind: "group" as const,
  id: "event-1",
  at,
  groupId: "family",
  type: "MEMBER_JOINED" as const,
  role: "MEMBER" as const,
  name: null,
  previousName: null,
  emoji: null,
  actor: null,
  subject: { userId: "user-sam", name: "Samantha" },
  ...extra,
});

const groups = async () =>
  [
    {
      id: "family",
      name: "Family",
      members: [{ id: "member-sam", userId: "user-sam", name: "Samantha" }],
    },
  ] as unknown as Awaited<ReturnType<Parameters<typeof showNotices>[0]["groups"]>>;

beforeEach(() => {
  storageValues.clear();
  shown.length = 0;
  failNotices = false;
});

describe("account notices", () => {
  test("name the signed-in device by its model or name, without an article", () => {
    const signIn = (
      device: { name: string | null; model: string | null; platform: string | null } | null,
    ) => describeAccountNotice(account("NEW_SIGN_IN", { device }));
    const advice = "signed in to your account. If this wasn’t you, remove it in Devices.";
    expect(signIn({ name: "Sam’s phone", model: "SM-S911B", platform: "android" })).toMatchObject({
      title: "New sign-in",
      body: `SM-S911B ${advice}`,
    });
    expect(signIn({ name: "Sam’s phone", model: null, platform: "android" }).body).toBe(
      `Sam’s phone ${advice}`,
    );
    expect(signIn(null).body).toBe(`A new phone or tablet ${advice}`);
  });

  test("match the advice in the security emails", () => {
    expect(describeAccountNotice(account("PASSWORD_CHANGED")).body).toBe(
      "If this wasn’t you, use Forgot password on the sign-in screen to choose a new one.",
    );
    expect(describeAccountNotice(account("DELETION_SCHEDULED")).body).toBe(
      "Sign in within 7 days to cancel it.",
    );
  });

  test("open the screen that deals with the change", () => {
    const urls = (
      [
        "NEW_SIGN_IN",
        "PASSWORD_CHANGED",
        "PASSWORD_RESET",
        "RECOVERY_PHRASE_CHANGED",
        "RECOVERY_PHRASE_RESET",
        "OTHER_SESSIONS_SIGNED_OUT",
        "DEVICE_REMOVED",
        "DELETION_SCHEDULED",
        "ALERTS_TURNED_OFF",
        "SIGN_IN_CODES_TURNED_ON",
        "SIGN_IN_CODES_TURNED_OFF",
        "OWNERSHIP_OFFERED",
      ] as const
    ).map((type) => describeAccountNotice(account(type)).link.url);
    expect(urls).toEqual([
      "openbeacon:///account/devices",
      "openbeacon:///account/password",
      "openbeacon:///account/password",
      "openbeacon:///account/recovery",
      "openbeacon:///account/recovery",
      "openbeacon:///account/devices",
      "openbeacon:///account/devices",
      "openbeacon:///account/delete",
      "openbeacon:///account/notifications",
      "openbeacon:///account/password",
      "openbeacon:///account/password",
      "openbeacon:///groups/list",
    ]);
  });

  test("say when seats end and which group a member's phones go on hold in", () => {
    const holdsFrom = new Date(2026, 10, 25, 12);
    const date = holdsFrom.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    expect(describeAccountNotice(account("SEATS_ENDING", { holdsFrom }))).toMatchObject({
      title: "Your seats have ended",
      body: `From ${date}, phones in the groups you own go on hold until you renew your seats. Open Account › Usage to see which.`,
      link: { url: "openbeacon:///account/usage" },
    });
    expect(describeAccountNotice(account("SEATS_ENDING_SOON", { holdsFrom })).title).toBe(
      "Phones in your groups go on hold tomorrow",
    );
    expect(
      describeAccountNotice(
        account("SEAT_HOLD_COMING", { group: { id: "g1", name: "Family" }, holdsFrom }),
      ),
    ).toMatchObject({
      title: `Your phones go on hold in Family on ${date}`,
      body: "The group’s owner has no seats after then, so your location won’t be shared there until they add seats. You can leave the group at any time.",
    });
  });

  test("name the group a request to become its owner is about", () => {
    expect(
      describeAccountNotice(account("OWNERSHIP_OFFERED", { group: { id: "g1", name: "Family" } })),
    ).toMatchObject({
      title: "You’ve been asked to become the owner of Family",
      body: "Open Groups to see what it means and accept or decline.",
    });
  });

  test("list the security alerts that were turned off and where", () => {
    const turnedOff = [
      { type: "NEW_SIGN_IN", channel: "phone" },
      { type: "PASSWORD_CHANGED", channel: "email" },
    ] as const;
    expect(
      describeAccountNotice(account("ALERTS_TURNED_OFF", { turnedOff: [...turnedOff] })),
    ).toMatchObject({
      title: "Security alerts turned off",
      body: "New sign-in (phone), Password changed or reset (email).",
    });
    expect(
      describeAccountNotice(
        account("ALERTS_TURNED_OFF", {
          turnedOff: [{ type: "DEVICE_REMOVED", channel: "email" }],
          device: { name: "Old tablet", model: "Tab S9", platform: "android" },
        }),
      ).body,
    ).toBe("Device removed (email). Turned off on Old tablet.");
  });

  test("say which device was removed or did the signing out", () => {
    const device = { name: "Old tablet", model: "Tab S9", platform: "android" };
    expect(describeAccountNotice(account("DEVICE_REMOVED", { device })).title).toBe(
      "Old tablet was removed from your account",
    );
    expect(describeAccountNotice(account("OTHER_SESSIONS_SIGNED_OUT", { device })).body).toBe(
      "Old tablet signed out your other phones and tablets.",
    );
    expect(describeAccountNotice(account("OTHER_SESSIONS_SIGNED_OUT")).body).toBeNull();
  });
});

describe("showing notices", () => {
  test("group notices use this phone's nicknames and the group name, then the cursor is saved", async () => {
    await showNotices({
      notices: {
        cursor: "2026-11-17T10:00:00.000Z|event-2",
        notices: [
          groupEvent({}),
          groupEvent({
            type: "ROLE_CHANGED",
            role: "EDITOR",
            actor: { userId: "user-sam", name: "Samantha" },
            subject: { userId: "user-1", name: "Me" },
          }),
          groupEvent({ type: "MEMBER_LEFT", subject: { userId: "user-gone", name: "Alex" } }),
          groupEvent({ groupId: "left-group" }),
        ],
      },
      groups,
      userId: "user-1",
    });
    expect(shown).toEqual([
      {
        kind: "groupActivity",
        title: "Mum joined",
        body: null,
        groupName: "Family",
        url: "openbeacon:///groups/family?tab=history",
      },
      {
        kind: "groupActivity",
        title: "Mum made you an Editor",
        body: null,
        groupName: "Family",
        url: "openbeacon:///groups/family?tab=history",
      },
      {
        kind: "groupActivity",
        title: "Alex left the group",
        body: null,
        groupName: "Family",
        url: "openbeacon:///groups/family?tab=history",
      },
    ]);
    expect(getNoticesCursor("user-1")).toBe("2026-11-17T10:00:00.000Z|event-2");
    expect(getNoticesCursor("user-2")).toBeNull();
    expect(getAccountNoticesCursor("user-1")).toBeNull();
  });

  test("account notices are security alerts with their own cursor", async () => {
    await showAccountNotices({
      notices: {
        cursor: "2026-11-17T11:00:00.000Z|notice-1",
        notices: [account("PASSWORD_CHANGED")],
      },
      userId: "user-1",
    });
    expect(shown).toEqual([
      {
        kind: "accountAlert",
        title: "Your password was changed",
        body: "If this wasn’t you, use Forgot password on the sign-in screen to choose a new one.",
        groupName: null,
        url: "openbeacon:///account/password",
      },
    ]);
    expect(getAccountNoticesCursor("user-1")).toBe("2026-11-17T11:00:00.000Z|notice-1");
    expect(getNoticesCursor("user-1")).toBeNull();
  });

  test("keeps the old cursor when showing fails, so the notices come again", async () => {
    failNotices = true;
    await expect(
      showNotices({
        notices: { cursor: "2026-11-17T10:00:00.000Z|", notices: [groupEvent({})] },
        groups,
        userId: "user-1",
      }),
    ).rejects.toThrow("Notifications unavailable");
    await expect(
      showAccountNotices({
        notices: { cursor: "2026-11-17T10:00:00.000Z|", notices: [account("PASSWORD_RESET")] },
        userId: "user-1",
      }),
    ).rejects.toThrow("Notifications unavailable");
    expect(getNoticesCursor("user-1")).toBeNull();
    expect(getAccountNoticesCursor("user-1")).toBeNull();
  });
});
