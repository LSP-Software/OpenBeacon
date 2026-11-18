import { alertsCursorSchema, notificationTypes } from "@openbeacon/schemas";
import type { RouterOutputs } from "./api.ts";
import { baseUrl } from "./currentServer.ts";
import { describeGroupEvent } from "./groupHistory.ts";
import { showEventNotice } from "./notifications.ts";
import { nicknamesByGroup } from "./nicknamesByGroup.ts";
import { storage } from "./storage.ts";

export type Notices = NonNullable<RouterOutputs["groupTracking"]["uploadBatch"]["notices"]>;

type AccountNotices = RouterOutputs["accountNotices"]["sync"];

const cursorKey = (userId: string) => `notices.cursor.${JSON.stringify([baseUrl, userId])}`;

const accountCursorKey = (userId: string) =>
  `notices.accountCursor.${JSON.stringify([baseUrl, userId])}`;

const readCursor = (key: string) => {
  const parsed = alertsCursorSchema.safeParse(storage.getString(key));
  return parsed.success ? parsed.data : null;
};

export const getNoticesCursor = (userId: string) => readCursor(cursorKey(userId));

export const getAccountNoticesCursor = (userId: string) => readCursor(accountCursorKey(userId));

const accountLink = (screen: "devices" | "password" | "recovery" | "delete" | "notifications") => ({
  href: `/account/${screen}` as const,
  url: `openbeacon:///account/${screen}`,
});

export const describeAccountNotice = (notice: AccountNotices["notices"][number]) => {
  switch (notice.type) {
    case "NEW_SIGN_IN":
      return {
        title: "New sign-in",
        body: `${notice.device?.model ?? notice.device?.name ?? "A new phone or tablet"} signed in to your account. If this wasn’t you, remove it in Devices.`,
        link: accountLink("devices"),
      };
    case "PASSWORD_CHANGED":
      return {
        title: "Your password was changed",
        body: "If this wasn’t you, use Forgot password on the sign-in screen to choose a new one.",
        link: accountLink("password"),
      };
    case "PASSWORD_RESET":
      return {
        title: "Your password was reset",
        body: "Every phone and tablet was signed out.",
        link: accountLink("password"),
      };
    case "RECOVERY_PHRASE_CHANGED":
    case "RECOVERY_PHRASE_RESET":
      return {
        title: `Your recovery phrase was ${notice.type === "RECOVERY_PHRASE_RESET" ? "reset" : "changed"}`,
        body: "Your old phrase no longer works.",
        link: accountLink("recovery"),
      };
    case "OTHER_SESSIONS_SIGNED_OUT":
      return {
        title: "Your other sessions were signed out",
        body: notice.device?.name
          ? `${notice.device.name} signed out your other phones and tablets.`
          : null,
        link: accountLink("devices"),
      };
    case "DEVICE_REMOVED":
      return {
        title: `${notice.device?.name ?? "A device"} was removed from your account`,
        body: "It was signed out and won’t receive new locations.",
        link: accountLink("devices"),
      };
    case "DELETION_SCHEDULED":
      return {
        title: notice.deletionDate
          ? `Your account will be deleted on ${notice.deletionDate.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
          : "Your account is scheduled for deletion",
        body: "Sign in within 7 days to cancel it.",
        link: accountLink("delete"),
      };
    case "SIGN_IN_CODES_TURNED_ON":
      return {
        title: "Sign-in codes turned on",
        body: "Signing in on a new phone now also needs a code from your email.",
        link: accountLink("password"),
      };
    case "SIGN_IN_CODES_TURNED_OFF":
      return {
        title: "Sign-in codes turned off",
        body: "Signing in now only needs your password. If this wasn’t you, change your password.",
        link: accountLink("password"),
      };
    case "OWNERSHIP_OFFERED":
      return {
        title: notice.group
          ? `You’ve been asked to become the owner of ${notice.group.name}`
          : "You’ve been asked to become a group’s owner",
        body: "Open Groups to see what it means and accept or decline.",
        link: { href: "/(tabs)/groups/list" as const, url: "openbeacon:///groups/list" },
      };
    case "ALERTS_TURNED_OFF": {
      const turnedOff = notice.turnedOff
        .map(({ type, channel }) => `${notificationTypes[type].label} (${channel})`)
        .join(", ");
      return {
        title: "Security alerts turned off",
        body:
          [
            turnedOff && `${turnedOff}.`,
            notice.device?.name && `Turned off on ${notice.device.name}.`,
          ]
            .filter(Boolean)
            .join(" ") || null,
        link: accountLink("notifications"),
      };
    }
  }
};

export const showAccountNotices = async ({
  notices,
  userId,
}: {
  notices: Pick<AccountNotices, "cursor" | "notices">;
  userId: string;
}) => {
  for (const notice of notices.notices) {
    const { title, body, link } = describeAccountNotice(notice);
    await showEventNotice({
      title,
      body,
      groupName: null,
      key: notice.id,
      kind: "accountAlert",
      link,
    });
  }
  storage.set(accountCursorKey(userId), notices.cursor);
};

export const showNotices = async ({
  notices,
  groups,
  userId,
}: {
  notices: Notices;
  groups: () => Promise<RouterOutputs["groupMembership"]["list"]>;
  userId: string;
}) => {
  const nicknamesFor = nicknamesByGroup(userId);
  for (const notice of notices.notices) {
    const group = (await groups()).find(({ id }) => id === notice.groupId);
    if (!group) continue;
    const groupNicknames = await nicknamesFor(notice.groupId);
    await showEventNotice({
      title: describeGroupEvent({
        event: notice,
        memberName: (memberUserId) => {
          const member = group.members.find((item) => item.userId === memberUserId);
          return member ? (groupNicknames[member.id]?.name ?? member.name) : null;
        },
        userId,
      }),
      body: null,
      groupName: group.name,
      key: notice.id,
      kind: "groupActivity",
      link: {
        href: {
          pathname: "/(tabs)/groups/[groupId]",
          params: { groupId: notice.groupId, tab: "history" },
        },
        url: `openbeacon:///groups/${encodeURIComponent(notice.groupId)}?tab=history`,
      },
    });
  }
  storage.set(cursorKey(userId), notices.cursor);
};
