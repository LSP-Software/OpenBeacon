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
mock.module("./currentServer.ts", () => ({ getBaseUrl: () => "https://api.example.test" }));
mock.module("./personalNicknames.ts", () => ({
  loadPersonalNicknames: async () => ({ "member-sam": { name: "Mum", ciphertext: "sealed" } }),
}));
let roundCurrent = true;
mock.module("./accountSession.ts", () => ({
  isRoundCurrent: () => roundCurrent,
  startAccountRound: (userId: string) => ({ userId, number: 1 }),
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
  describeGroupNotice,
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
  turnedOff: [],
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
  roundCurrent = true;
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
    expect(signIn({ name: "Sam’s phone", model: null, platform: "android" })?.body).toBe(
      `Sam’s phone ${advice}`,
    );
    expect(signIn(null)?.body).toBe(`A new phone or tablet ${advice}`);
  });

  test("match the advice in the security emails", () => {
    expect(describeAccountNotice(account("PASSWORD_CHANGED"))?.body).toBe(
      "Your password was changed. If this wasn’t you, use Forgot password on the sign-in screen to choose a new one.",
    );
    expect(describeAccountNotice(account("DELETION_SCHEDULED"))?.body).toBe(
      "Your account is scheduled for deletion. Sign in within 7 days to cancel it.",
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
      ] as const
    ).map((type) => describeAccountNotice(account(type))?.link.url);
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
    ]);
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
      )?.body,
    ).toBe("Device removed (email). Turned off on Old tablet.");
  });

  test("say which device was removed or did the signing out", () => {
    const device = { name: "Old tablet", model: "Tab S9", platform: "android" };
    expect(describeAccountNotice(account("DEVICE_REMOVED", { device }))).toMatchObject({
      title: "Device removed",
      body: "Old tablet was removed from your account. It was signed out and won’t receive new locations.",
    });
    expect(describeAccountNotice(account("OTHER_SESSIONS_SIGNED_OUT", { device }))?.body).toBe(
      "Old tablet signed out your other phones and tablets. If this wasn’t you, change your password.",
    );
    expect(describeAccountNotice(account("OTHER_SESSIONS_SIGNED_OUT"))?.body).toBe(
      "One of your phones or tablets signed out your other phones and tablets. If this wasn’t you, change your password.",
    );
  });

  test("every security alert has a short title and a description", () => {
    const types = [
      "NEW_SIGN_IN",
      "PASSWORD_CHANGED",
      "PASSWORD_RESET",
      "RECOVERY_PHRASE_CHANGED",
      "RECOVERY_PHRASE_RESET",
      "OTHER_SESSIONS_SIGNED_OUT",
      "DEVICE_REMOVED",
      "DELETION_SCHEDULED",
      "SIGN_IN_CODES_TURNED_ON",
      "SIGN_IN_CODES_TURNED_OFF",
      "ALERTS_TURNED_OFF",
    ] as const;
    for (const type of types) {
      const described = describeAccountNotice(
        account(type, {
          deletionDate: new Date("2026-12-03T12:00:00.000Z"),
          device: { name: "A very long tablet name indeed", model: null, platform: null },
        }),
      );
      expect(described?.title.length).toBeLessThanOrEqual(30);
      expect(described?.body).toBeTruthy();
    }
    expect(describeAccountNotice(account("ALERTS_TURNED_OFF"))?.body).toBe(
      "Some security alerts were turned off for your account.",
    );
  });
});

describe("group notices", () => {
  const groupNotice = (event: Parameters<typeof groupEvent>[0]) =>
    describeGroupNotice({
      event: groupEvent(event),
      groupName: "The Kings",
      memberName: () => null,
      userId: "user-1",
    });

  test("name the group in the title and add only what the title leaves out", () => {
    expect(groupNotice({ subject: { userId: "user-emma", name: "Emma" } })).toEqual({
      title: "Emma joined The Kings",
      body: null,
    });
    expect(
      groupNotice({ subject: { userId: "user-emma", name: "Emma" }, role: "ADMIN" })?.body,
    ).toBe("Joined as an admin.");
    expect(
      groupNotice({
        type: "MEMBER_REMOVED" as "MEMBER_LEFT",
        actor: { userId: "user-sam", name: "Sam" },
        subject: { userId: "user-emma", name: "Emma" },
      }),
    ).toEqual({
      title: "Emma was removed from The Kings",
      body: "Removed by Sam.",
    });
    expect(groupNotice({ type: "ACCOUNT_DELETED" as "MEMBER_LEFT", subject: null })).toEqual({
      title: "A member left The Kings",
      body: "They deleted their account.",
    });
    expect(
      groupNotice({
        type: "ROLE_CHANGED",
        role: "OWNER",
        actor: { userId: "user-emma", name: "Emma" },
        subject: { userId: "user-emma", name: "Emma" },
      }),
    ).toEqual({
      title: "Emma is now an owner of The Kings",
      body: null,
    });
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
        ],
      },
      groups,
      round: { userId: "user-1", number: 1 },
    });
    expect(shown).toEqual([
      {
        kind: "groupActivity",
        title: "Mum joined Family",
        body: null,
        groupName: "Family",
        url: "openbeacon:///groups/family?tab=history",
      },
      {
        kind: "groupActivity",
        title: "You are now an admin of Family",
        body: "Changed by Mum.",
        groupName: "Family",
        url: "openbeacon:///groups/family?tab=history",
      },
      {
        kind: "groupActivity",
        title: "Alex left Family",
        body: null,
        groupName: "Family",
        url: "openbeacon:///groups/family?tab=history",
      },
    ]);
    expect(getNoticesCursor("user-1")).toBe("2026-11-17T10:00:00.000Z|event-2");
    expect(getNoticesCursor("user-2")).toBeNull();
    expect(getAccountNoticesCursor("user-1")).toBeNull();
  });

  test("a round that ended keeps both cursors, so its notices come again", async () => {
    roundCurrent = false;
    const round = { userId: "user-1", number: 1 };
    await showNotices({
      notices: { cursor: "2026-11-17T10:00:00.000Z|event-1", notices: [groupEvent({})] },
      groups,
      round,
    });
    await showAccountNotices({
      notices: {
        cursor: "2026-11-17T11:00:00.000Z|notice-1",
        notices: [account("PASSWORD_CHANGED")],
      },
      round,
    });
    expect(getNoticesCursor("user-1")).toBeNull();
    expect(getAccountNoticesCursor("user-1")).toBeNull();
  });

  test("account notices are security alerts with their own cursor", async () => {
    await showAccountNotices({
      notices: {
        cursor: "2026-11-17T11:00:00.000Z|notice-1",
        notices: [account("PASSWORD_CHANGED")],
      },
      round: { userId: "user-1", number: 1 },
    });
    expect(shown).toEqual([
      {
        kind: "accountAlert",
        title: "Password changed",
        body: "Your password was changed. If this wasn’t you, use Forgot password on the sign-in screen to choose a new one.",
        groupName: null,
        url: "openbeacon:///account/password",
      },
    ]);
    expect(getAccountNoticesCursor("user-1")).toBe("2026-11-17T11:00:00.000Z|notice-1");
    expect(getNoticesCursor("user-1")).toBeNull();
  });

  test("an account notice of a type this build doesn't know is skipped and the cursor still moves", async () => {
    await showAccountNotices({
      notices: {
        cursor: "2026-11-17T11:00:00.000Z|notice-NEW_SIGN_IN",
        notices: [
          account("EMAIL_CHANGED" as Parameters<typeof account>[0]),
          account("NEW_SIGN_IN"),
        ],
      },
      round: { userId: "user-1", number: 1 },
    });
    expect(shown.map(({ title }) => title)).toEqual(["New sign-in"]);
    expect(getAccountNoticesCursor("user-1")).toBe("2026-11-17T11:00:00.000Z|notice-NEW_SIGN_IN");
  });

  test("an alerts-turned-off notice naming a setting this build doesn't know lists only the known ones", async () => {
    await showAccountNotices({
      notices: {
        cursor: "2026-11-17T11:00:00.000Z|notice-ALERTS_TURNED_OFF",
        notices: [
          account("ALERTS_TURNED_OFF", {
            turnedOff: [
              { type: "SEAT_LIMIT_REACHED", channel: "email" },
              { type: "NEW_SIGN_IN", channel: "phone" },
            ] as Parameters<typeof describeAccountNotice>[0]["turnedOff"],
          }),
        ],
      },
      round: { userId: "user-1", number: 1 },
    });
    expect(shown.map(({ title, body }) => ({ title, body }))).toEqual([
      { title: "Security alerts turned off", body: "New sign-in (phone)." },
    ]);
    expect(getAccountNoticesCursor("user-1")).toBe(
      "2026-11-17T11:00:00.000Z|notice-ALERTS_TURNED_OFF",
    );
  });

  test("a group notice of a type this build doesn't know isn't shown untitled", async () => {
    await showNotices({
      notices: {
        cursor: "2026-11-17T10:00:00.000Z|event-1",
        notices: [
          groupEvent({ type: "SEATS_CHANGED" as "MEMBER_JOINED" }),
          groupEvent({ type: "MEMBER_LEFT" }),
        ],
      },
      groups,
      round: { userId: "user-1", number: 1 },
    });
    expect(shown.map(({ title }) => title)).toEqual(["Mum left Family"]);
    expect(getNoticesCursor("user-1")).toBe("2026-11-17T10:00:00.000Z|event-1");
  });

  test("keeps the old cursor when showing fails, so the notices come again", async () => {
    failNotices = true;
    await expect(
      showNotices({
        notices: { cursor: "2026-11-17T10:00:00.000Z|", notices: [groupEvent({})] },
        groups,
        round: { userId: "user-1", number: 1 },
      }),
    ).rejects.toThrow("Notifications unavailable");
    await expect(
      showAccountNotices({
        notices: { cursor: "2026-11-17T10:00:00.000Z|", notices: [account("PASSWORD_RESET")] },
        round: { userId: "user-1", number: 1 },
      }),
    ).rejects.toThrow("Notifications unavailable");
    expect(getNoticesCursor("user-1")).toBeNull();
    expect(getAccountNoticesCursor("user-1")).toBeNull();
  });
});
