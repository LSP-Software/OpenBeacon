import { alertsCursorSchema, notificationTypes } from "@openbeacon/schemas";
import { type AccountRound, isRoundCurrent } from "./accountSession.ts";
import type { RouterOutputs } from "./api.ts";
import { getBaseUrl } from "./currentServer.ts";
import type { GroupHistoryItem } from "./groupHistory.ts";
import { showEventNotice } from "./notifications.ts";
import { nicknamesByGroup } from "./nicknamesByGroup.ts";
import { storage } from "./storage.ts";

export type Notices = NonNullable<RouterOutputs["groupTracking"]["uploadBatch"]["notices"]>;

type AccountNotices = RouterOutputs["accountNotices"]["sync"];

const cursorKey = (userId: string) => `notices.cursor.${JSON.stringify([getBaseUrl(), userId])}`;

const accountCursorKey = (userId: string) =>
  `notices.accountCursor.${JSON.stringify([getBaseUrl(), userId])}`;

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
        title: "Password changed",
        body: "Your password was changed. If this wasn’t you, use Forgot password on the sign-in screen to choose a new one.",
        link: accountLink("password"),
      };
    case "PASSWORD_RESET":
      return {
        title: "Password reset",
        body: "Your password was reset and every phone and tablet was signed out.",
        link: accountLink("password"),
      };
    case "RECOVERY_PHRASE_CHANGED":
    case "RECOVERY_PHRASE_RESET":
      return {
        title: `Recovery phrase ${notice.type === "RECOVERY_PHRASE_RESET" ? "reset" : "changed"}`,
        body: `Your recovery phrase was ${notice.type === "RECOVERY_PHRASE_RESET" ? "reset" : "changed"}. Your old phrase no longer works.`,
        link: accountLink("recovery"),
      };
    case "OTHER_SESSIONS_SIGNED_OUT":
      return {
        title: "Other sessions signed out",
        body: `${notice.device?.name ?? "One of your phones or tablets"} signed out your other phones and tablets. If this wasn’t you, change your password.`,
        link: accountLink("devices"),
      };
    case "DEVICE_REMOVED":
      return {
        title: "Device removed",
        body: `${notice.device?.name ?? "A phone or tablet"} was removed from your account. It was signed out and won’t receive new locations.`,
        link: accountLink("devices"),
      };
    case "DELETION_SCHEDULED":
      return {
        title: "Account deletion scheduled",
        body: `${
          notice.deletionDate
            ? `Your account will be deleted on ${notice.deletionDate.toLocaleDateString(undefined, { day: "numeric", month: "short" })}.`
            : "Your account is scheduled for deletion."
        } Sign in within 7 days to cancel it.`,
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
    case "ALERTS_TURNED_OFF": {
      const turnedOff = notice.turnedOff
        .filter(({ type }) => Object.hasOwn(notificationTypes, type))
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
            .join(" ") || "Some security alerts were turned off for your account.",
        link: accountLink("notifications"),
      };
    }
    default:
      return null;
  }
};

export const describeGroupNotice = ({
  event,
  groupName,
  memberName,
  userId,
}: {
  event: Extract<GroupHistoryItem, { kind: "group" }>;
  groupName: string;
  memberName: (memberUserId: string) => string | null;
  userId: string;
}) => {
  const person = (who: { userId: string; name: string } | null, startOfSentence: boolean) => {
    if (!who) return startOfSentence ? "A deleted account" : "a deleted account";
    if (who.userId === userId) return startOfSentence ? "You" : "you";
    return memberName(who.userId) ?? who.name;
  };
  const subject = person(event.subject, true);
  const role =
    event.role === "OWNER" ? "an owner" : event.role === "ADMIN" ? "an admin" : "a member";
  switch (event.type) {
    case "MEMBER_JOINED":
      return {
        title: `${subject} joined ${groupName}`,
        body: event.role === "OWNER" || event.role === "ADMIN" ? `Joined as ${role}.` : null,
      };
    case "MEMBER_LEFT":
      return { title: `${subject} left ${groupName}`, body: null };
    case "MEMBER_REMOVED":
      return {
        title: `${subject} ${subject === "You" ? "were" : "was"} removed from ${groupName}`,
        body: `Removed by ${person(event.actor, false)}.`,
      };
    case "ACCOUNT_DELETED":
      return { title: `A member left ${groupName}`, body: "They deleted their account." };
    case "ROLE_CHANGED":
      return {
        title: `${subject} ${subject === "You" ? "are" : "is"} now ${role} of ${groupName}`,
        body:
          event.actor && event.actor.userId !== event.subject?.userId
            ? `Changed by ${person(event.actor, false)}.`
            : null,
      };
    default:
      return null;
  }
};

export const showAccountNotices = async ({
  notices,
  round,
}: {
  notices: Pick<AccountNotices, "cursor" | "notices">;
  round: AccountRound;
}) => {
  for (const notice of notices.notices) {
    const described = describeAccountNotice(notice);
    if (!described) continue;
    await showEventNotice({
      ...described,
      groupName: null,
      key: notice.id,
      kind: "accountAlert",
      round,
    });
  }
  if (isRoundCurrent(round)) storage.set(accountCursorKey(round.userId), notices.cursor);
};

export const showNotices = async ({
  notices,
  groups,
  round,
}: {
  notices: Notices;
  groups: () => Promise<RouterOutputs["groupMembership"]["list"]>;
  round: AccountRound;
}) => {
  const { userId } = round;
  const nicknamesFor = nicknamesByGroup(userId);
  for (const notice of notices.notices) {
    const group = (await groups()).find(({ id }) => id === notice.groupId);
    if (!group) continue;
    const groupNicknames = await nicknamesFor(notice.groupId);
    const described = describeGroupNotice({
      event: notice,
      groupName: group.name,
      memberName: (memberUserId) => {
        const member = group.members.find((item) => item.userId === memberUserId);
        return member ? (groupNicknames[member.id]?.name ?? member.name) : null;
      },
      userId,
    });
    if (!described) continue;
    await showEventNotice({
      ...described,
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
      round,
    });
  }
  if (isRoundCurrent(round)) storage.set(cursorKey(userId), notices.cursor);
};
