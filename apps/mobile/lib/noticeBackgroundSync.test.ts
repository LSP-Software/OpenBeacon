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

const { describeAccountNotice, getNoticesCursor, showNotices } =
  await import("./noticeBackgroundSync.ts");

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
  ...extra,
});

const groupEvent = (
  extra: Partial<{
    type: "MEMBER_JOINED" | "MEMBER_LEFT" | "ROLE_CHANGED";
    actor: { userId: string; name: string } | null;
    subject: { userId: string; name: string } | null;
    role: "OWNER" | "ADMIN" | "MEMBER" | null;
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
  test("name the signed-in device with the right article, or leave it out", () => {
    const signIn = (
      device: { name: string | null; model: string | null; platform: string | null } | null,
    ) => describeAccountNotice(account("NEW_SIGN_IN", { device })).title;
    expect(signIn({ name: null, model: "Pixel 8", platform: "android" })).toBe(
      "New sign-in on a Pixel 8",
    );
    expect(signIn({ name: null, model: "iPhone 15", platform: "ios" })).toBe(
      "New sign-in on an iPhone 15",
    );
    expect(signIn({ name: null, model: null, platform: "android" })).toBe(
      "New sign-in on an Android device",
    );
    expect(signIn(null)).toBe("New sign-in");
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
    ]);
  });

  test("say which device was removed or did the signing out", () => {
    const device = { name: "Old tablet", model: "Tab S9", platform: "android" };
    expect(describeAccountNotice(account("DEVICE_REMOVED", { device })).title).toBe(
      "Old tablet was removed from your account",
    );
    expect(describeAccountNotice(account("OTHER_SESSIONS_SIGNED_OUT", { device })).body).toBe(
      "Signed out from Old tablet.",
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
            role: "ADMIN",
            actor: { userId: "user-sam", name: "Samantha" },
            subject: { userId: "user-1", name: "Me" },
          }),
          groupEvent({ type: "MEMBER_LEFT", subject: { userId: "user-gone", name: "Alex" } }),
          groupEvent({ groupId: "left-group" }),
          account("PASSWORD_CHANGED"),
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
        title: "Mum made you an admin",
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
      {
        kind: "accountAlert",
        title: "Your password was changed",
        body: "If this wasn’t you, reset your password and sign out other sessions.",
        groupName: null,
        url: "openbeacon:///account/password",
      },
    ]);
    expect(getNoticesCursor("user-1")).toBe("2026-11-17T10:00:00.000Z|event-2");
    expect(getNoticesCursor("user-2")).toBeNull();
  });

  test("keeps the old cursor when showing fails, so the notices come again", async () => {
    failNotices = true;
    await expect(
      showNotices({
        notices: { cursor: "2026-11-17T10:00:00.000Z|", notices: [account("PASSWORD_RESET")] },
        groups,
        userId: "user-1",
      }),
    ).rejects.toThrow("Notifications unavailable");
    expect(getNoticesCursor("user-1")).toBeNull();
  });
});
