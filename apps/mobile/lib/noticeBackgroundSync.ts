import { alertsCursorSchema } from "@openbeacon/schemas";
import type { RouterOutputs } from "./api.ts";
import { baseUrl } from "./currentServer.ts";
import { describeGroupEvent } from "./groupHistory.ts";
import { showEventNotice } from "./notifications.ts";
import { nicknamesByGroup } from "./nicknamesByGroup.ts";
import { storage } from "./storage.ts";

export type Notices = NonNullable<RouterOutputs["groupTracking"]["uploadBatch"]["notices"]>;

type AccountNotice = Extract<Notices["notices"][number], { kind: "account" }>;

const cursorKey = (userId: string) => `notices.cursor.${JSON.stringify([baseUrl, userId])}`;

export const getNoticesCursor = (userId: string) => {
  const parsed = alertsCursorSchema.safeParse(storage.getString(cursorKey(userId)));
  return parsed.success ? parsed.data : null;
};

const accountLink = (screen: "devices" | "password" | "recovery" | "delete") => ({
  href: `/account/${screen}` as const,
  url: `openbeacon:///account/${screen}`,
});

export const describeAccountNotice = (notice: AccountNotice) => {
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
  }
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
    if (notice.kind === "account") {
      const { title, body, link } = describeAccountNotice(notice);
      await showEventNotice({
        title,
        body,
        groupName: null,
        key: notice.id,
        kind: "accountAlert",
        link,
      });
      continue;
    }
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
