import type {
  AccountNoticeType,
  GroupEventType,
  NotificationType,
  PrismaClient,
} from "@openbeacon/database";
import { effectiveNotificationSetting } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import type { FcmClient } from "./fcm.ts";

export const accountNoticeSettings = {
  NEW_SIGN_IN: "NEW_SIGN_IN",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PASSWORD_RESET: "PASSWORD_CHANGED",
  RECOVERY_PHRASE_CHANGED: "RECOVERY_PHRASE_CHANGED",
  RECOVERY_PHRASE_RESET: "RECOVERY_PHRASE_CHANGED",
  OTHER_SESSIONS_SIGNED_OUT: "OTHER_SESSIONS_SIGNED_OUT",
  DEVICE_REMOVED: "DEVICE_REMOVED",
  DELETION_SCHEDULED: "DELETION_SCHEDULED",
} as const satisfies Record<AccountNoticeType, NotificationType>;

export const groupNoticeSettings = {
  MEMBER_JOINED: "MEMBER_JOINED",
  MEMBER_LEFT: "MEMBER_LEFT",
  MEMBER_REMOVED: "MEMBER_LEFT",
  ACCOUNT_DELETED: "MEMBER_LEFT",
  ROLE_CHANGED: "ROLE_CHANGED",
} as const satisfies Partial<Record<GroupEventType, NotificationType>>;

const signsOutOtherDevices: AccountNoticeType[] = [
  "OTHER_SESSIONS_SIGNED_OUT",
  "PASSWORD_RESET",
  "DELETION_SCHEDULED",
];

export const createPushSender = ({
  db,
  fcm,
  setTimer = (callback, ms) => {
    setTimeout(callback, ms);
  },
  runInBackground = () => {},
}: {
  db: PrismaClient;
  fcm: Pick<FcmClient, "send"> | null;
  setTimer?: (callback: () => void, ms: number) => void;
  runInBackground?: (task: Promise<unknown>) => void;
}) => {
  const settleMs = 16_000;
  const batchMs = 1_000;
  const logError = (message: string) =>
    console.error(`${new Date().toISOString()} [push] ${message}`);
  const background = (task: () => Promise<unknown>, failure: string) =>
    runInBackground(
      tryCatch(task()).then((result) => {
        if (result.error) logError(failure);
      }),
    );

  const phoneOn = async (userIds: string[], type: NotificationType) => {
    const stored = await db.notificationSetting.findMany({
      where: { userId: { in: userIds }, type },
      select: { userId: true, email: true, phone: true },
    });
    return userIds.filter(
      (userId) =>
        effectiveNotificationSetting(
          type,
          stored.find((setting) => setting.userId === userId),
        ).phone,
    );
  };

  const devicesOf = async (userIds: string[], excludeDeviceId: string | null = null) =>
    userIds.length === 0
      ? []
      : (
          await db.userDevice.findMany({
            where: {
              userId: { in: userIds },
              activatedAt: { not: null },
              revokedAt: null,
              pushToken: { isNot: null },
              ...(excludeDeviceId ? { id: { not: excludeDeviceId } } : {}),
            },
            select: { id: true },
          })
        ).map(({ id }) => id);

  const placeTransitionRecipients = async ({
    deviceId,
    clientIds,
  }: {
    deviceId: string;
    clientIds: string[];
  }) => {
    const [clock] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const oldestAlert = new Date((clock?.now ?? new Date()).getTime() - 24 * 60 * 60_000);
    const transitions = await db.placeTransition.findMany({
      where: { deviceId, clientId: { in: clientIds }, occurredAt: { gte: oldestAlert } },
      select: { groupId: true, placeId: true, userId: true, occurredAt: true },
    });
    const recipients = new Set<string>();
    for (const transition of transitions) {
      const members = await db.groupMember.findMany({
        where: {
          groupId: transition.groupId,
          userId: { not: transition.userId },
          createdAt: { lte: transition.occurredAt },
        },
        select: { userId: true },
      });
      const mutes = await db.placeAlertMute.findMany({
        where: {
          placeId: transition.placeId,
          muterUserId: { in: members.map(({ userId }) => userId) },
          OR: [{ mutedUserId: null }, { mutedUserId: transition.userId }],
        },
        select: { muterUserId: true },
      });
      const muted = new Set(mutes.map(({ muterUserId }) => muterUserId));
      for (const userId of await phoneOn(
        members.map(({ userId }) => userId).filter((userId) => !muted.has(userId)),
        "PLACE_ALERTS",
      )) {
        recipients.add(userId);
      }
    }
    return devicesOf([...recipients]);
  };

  const groupEventRecipients = async (eventIds: string[]) => {
    const events = await db.groupEvent.findMany({
      where: {
        id: { in: eventIds },
        type: { in: Object.keys(groupNoticeSettings) as (keyof typeof groupNoticeSettings)[] },
      },
      select: {
        groupId: true,
        type: true,
        actorUserId: true,
        subjectUserId: true,
        createdAt: true,
      },
    });
    const recipients = new Set<string>();
    for (const event of events) {
      const members = await db.groupMember.findMany({
        where: {
          groupId: event.groupId,
          createdAt: { lt: event.createdAt },
          ...(event.actorUserId ? { userId: { not: event.actorUserId } } : {}),
        },
        select: { userId: true },
      });
      const userIds = members
        .map(({ userId }) => userId)
        .filter((userId) => event.type !== "MEMBER_JOINED" || userId !== event.subjectUserId);
      const type = groupNoticeSettings[event.type as keyof typeof groupNoticeSettings];
      for (const userId of await phoneOn(userIds, type)) recipients.add(userId);
    }
    return devicesOf([...recipients]);
  };

  const accountNoticeRecipients = async (noticeId: string) => {
    const notice = await db.accountNotice.findUnique({
      where: { id: noticeId },
      select: { userId: true, type: true, excludeDeviceId: true },
    });
    if (!notice || signsOutOtherDevices.includes(notice.type)) return [];
    const userIds = await phoneOn([notice.userId], accountNoticeSettings[notice.type]);
    return devicesOf(userIds, notice.excludeDeviceId);
  };

  const queued = new Set<string>();

  const sendTo = async (deviceId: string, token: string, retried = false): Promise<void> => {
    if (!fcm) return;
    const result = await fcm.send(token);
    if (result.outcome === "sent") return;
    if (result.outcome === "unregistered") {
      await db.pushToken.deleteMany({ where: { deviceId, token } });
      return;
    }
    if (result.outcome === "retry" && !retried) {
      setTimer(
        () => background(() => sendTo(deviceId, token, true), "could not send a retried wake"),
        result.afterMs,
      );
      return;
    }
    logError(
      result.outcome === "failed"
        ? `FCM refused a wake (${result.status})`
        : "FCM was unavailable twice, so a wake was dropped",
    );
  };

  const flush = async () => {
    const deviceIds = [...queued];
    queued.clear();
    const tokens = await db.pushToken.findMany({
      where: {
        deviceId: { in: deviceIds },
        device: { activatedAt: { not: null }, revokedAt: null },
      },
      select: { deviceId: true, token: true },
    });
    await Promise.all(
      tokens.map(({ deviceId, token }) =>
        tryCatch(sendTo(deviceId, token)).then((result) => {
          if (result.error) logError("could not send a wake");
        }),
      ),
    );
  };

  const wakeAfterSettle = (pick: () => Promise<string[]>) => {
    if (!fcm) return;
    setTimer(
      () =>
        background(async () => {
          const deviceIds = (await pick()).filter((deviceId) => !queued.has(deviceId));
          if (deviceIds.length === 0) return;
          const startBatch = queued.size === 0;
          for (const deviceId of deviceIds) queued.add(deviceId);
          if (startBatch) setTimer(() => background(flush, "could not send wakes"), batchMs);
        }, "could not choose who to wake"),
      settleMs,
    );
  };

  return {
    enabled: fcm !== null,
    placeTransitions: (transitions: { deviceId: string; clientIds: string[] }) => {
      if (transitions.clientIds.length > 0) {
        wakeAfterSettle(() => placeTransitionRecipients(transitions));
      }
    },
    groupEvents: (eventIds: string[]) => {
      if (eventIds.length > 0) wakeAfterSettle(() => groupEventRecipients(eventIds));
    },
    accountNotice: (noticeId: string) => wakeAfterSettle(() => accountNoticeRecipients(noticeId)),
  };
};

export type PushSender = ReturnType<typeof createPushSender>;
