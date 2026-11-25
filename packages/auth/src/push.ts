import {
  type AccountNoticeType,
  type GroupEventType,
  type NotificationType,
  type Prisma,
  type PrismaClient,
  readDatabaseTime,
} from "@openbeacon/database";
import { effectiveNotificationSetting } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import type { FcmClient, WakeKind } from "./fcm.ts";

export const noticeSettleMs = 15_000;
export const noticeLookbackMs = 24 * 60 * 60_000;

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
  now = () => Date.now(),
}: {
  db: PrismaClient;
  fcm: Pick<FcmClient, "send"> | null;
  setTimer?: (callback: () => void, ms: number) => void;
  runInBackground?: (task: Promise<unknown>) => void;
  now?: () => number;
}) => {
  const settleMs = noticeSettleMs + 1_000;
  const batchMs = 1_000;
  const wakeGapMs = 60_000;
  const logError = (message: string) =>
    console.error(`${new Date().toISOString()} [push] ${message}`);
  const background = (task: () => Promise<unknown>, failure: string) =>
    runInBackground(
      tryCatch(task()).then((result) => {
        if (result.error) logError(failure);
      }),
    );

  const usersWithPhoneOn = async (userIds: string[], type: NotificationType) => {
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

  const usableDevice = (): Prisma.UserDeviceWhereInput => ({
    activatedAt: { not: null },
    revokedAt: null,
    sessions: { some: { expiresAt: { gt: new Date() } } },
  });

  const devicesOf = async (userIds: string[], excludeDeviceId: string | null = null) =>
    userIds.length === 0
      ? []
      : (
          await db.userDevice.findMany({
            where: {
              ...usableDevice(),
              userId: { in: userIds },
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
    const oldestAlert = new Date((await readDatabaseTime(db)).getTime() - noticeLookbackMs);
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
      for (const userId of await usersWithPhoneOn(
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
      for (const userId of await usersWithPhoneOn(userIds, type)) recipients.add(userId);
    }
    return devicesOf([...recipients]);
  };

  const accountNoticeRecipients = async (noticeId: string) => {
    const notice = await db.accountNotice.findUnique({
      where: { id: noticeId },
      select: { userId: true, type: true, excludeDeviceId: true },
    });
    if (!notice || signsOutOtherDevices.includes(notice.type)) return [];
    return devicesOf([notice.userId], notice.excludeDeviceId);
  };

  const crashAlertRecipients = async (rowIds: string[]) => {
    const alerts = await db.crashAlert.findMany({
      where: { id: { in: rowIds } },
      select: { groupId: true, senderUserId: true, receivedAt: true },
    });
    const recipients = new Set<string>();
    for (const alert of alerts) {
      const members = await db.groupMember.findMany({
        where: {
          groupId: alert.groupId,
          userId: { not: alert.senderUserId },
          createdAt: { lte: alert.receivedAt },
        },
        select: { userId: true },
      });
      for (const userId of await usersWithPhoneOn(
        members.map(({ userId }) => userId),
        "CRASH_ALERTS",
      )) {
        recipients.add(userId);
      }
    }
    return devicesOf([...recipients]);
  };

  const driveRecipients = async ({
    groupId,
    driveIds,
  }: {
    groupId: string;
    driveIds: string[];
  }) => {
    const drives = await db.driveCopy.findMany({
      where: { groupId, driveId: { in: driveIds } },
      select: { senderUserId: true, receivedAt: true },
    });
    const recipients = new Set<string>();
    for (const drive of drives) {
      const members = await db.groupMember.findMany({
        where: {
          groupId,
          userId: { not: drive.senderUserId },
          createdAt: { lte: drive.receivedAt },
        },
        select: { userId: true },
      });
      const mutes = await db.driveAlertMute.findMany({
        where: {
          groupId,
          muterUserId: { in: members.map(({ userId }) => userId) },
          OR: [{ mutedUserId: null }, { mutedUserId: drive.senderUserId }],
        },
        select: { muterUserId: true },
      });
      const muted = new Set(mutes.map(({ muterUserId }) => muterUserId));
      for (const userId of await usersWithPhoneOn(
        members.map(({ userId }) => userId).filter((userId) => !muted.has(userId)),
        "DRIVES",
      )) {
        recipients.add(userId);
      }
    }
    return devicesOf([...recipients]);
  };

  const queued = new Map<string, WakeKind>();
  const urgent = new Set<string>();
  const lastWokenAt = new Map<string, number>();
  const lastLocatedAt = new Map<string, number>();
  const followUps = new Set<string>();

  const sendTo = async (
    deviceId: string,
    token: string,
    kind: WakeKind,
    retried = false,
  ): Promise<void> => {
    if (!fcm) return;
    const result = await fcm.send(token, kind);
    if (result.outcome === "sent") return;
    if (result.outcome === "unregistered") {
      await db.pushToken.deleteMany({ where: { deviceId, token } });
      return;
    }
    if (result.outcome === "retry" && kind === "locate" && result.afterMs > 30_000) {
      logError("FCM asked to wait past an update request's lifetime, so a wake was dropped");
      return;
    }
    if (result.outcome === "retry" && !retried) {
      setTimer(
        () =>
          background(() => sendTo(deviceId, token, kind, true), "could not send a retried wake"),
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

  const queue = (deviceIds: string[], kind: WakeKind = "sync", isUrgent = false) => {
    if (isUrgent) for (const deviceId of deviceIds) urgent.add(deviceId);
    const fresh = deviceIds.filter(
      (deviceId) => !queued.has(deviceId) || (kind === "locate" && queued.get(deviceId) === "sync"),
    );
    if (fresh.length === 0) return;
    const startBatch = queued.size === 0;
    for (const deviceId of fresh) queued.set(deviceId, kind);
    if (startBatch) setTimer(() => background(flush, "could not send wakes"), batchMs);
  };

  const flush = async () => {
    const at = now();
    for (const woken of [lastWokenAt, lastLocatedAt]) {
      for (const [deviceId, wokenAt] of woken) {
        if (at - wokenAt >= wakeGapMs) woken.delete(deviceId);
      }
    }
    const due = [...queued].filter(([deviceId, kind]) => {
      if (kind === "locate" && !lastLocatedAt.has(deviceId)) return true;
      if (urgent.has(deviceId)) return true;
      const wokenAt = lastWokenAt.get(deviceId);
      if (wokenAt === undefined) return true;
      if (!followUps.has(deviceId)) {
        followUps.add(deviceId);
        setTimer(
          () => {
            followUps.delete(deviceId);
            queue([deviceId]);
          },
          wokenAt + wakeGapMs - at,
        );
      }
      return false;
    });
    queued.clear();
    urgent.clear();
    if (due.length === 0) return;
    for (const [deviceId, kind] of due) {
      lastWokenAt.set(deviceId, at);
      if (kind === "locate") lastLocatedAt.set(deviceId, at);
    }
    const kinds = new Map(due);
    const tokens = await db.pushToken.findMany({
      where: {
        deviceId: { in: [...kinds.keys()] },
        device: usableDevice(),
      },
      select: { deviceId: true, token: true },
    });
    await Promise.all(
      tokens.map(({ deviceId, token }) =>
        tryCatch(sendTo(deviceId, token, kinds.get(deviceId) ?? "sync")).then((result) => {
          if (result.error) logError("could not send a wake");
        }),
      ),
    );
  };

  const wakeAfterSettle = (pick: () => Promise<string[]>) => {
    if (!fcm) return;
    setTimer(
      () => background(async () => queue(await pick()), "could not choose who to wake"),
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
    drives: (drives: { groupId: string; driveIds: string[] }) => {
      if (drives.driveIds.length > 0) wakeAfterSettle(() => driveRecipients(drives));
    },
    accountNotice: (noticeId: string) => wakeAfterSettle(() => accountNoticeRecipients(noticeId)),
    crashAlerts: (rowIds: string[]) => {
      if (!fcm || rowIds.length === 0) return;
      background(
        async () => queue(await crashAlertRecipients(rowIds), "sync", true),
        "could not choose who to wake for a crash alert",
      );
    },
    requestLocation: (deviceIds: string[]) => {
      if (fcm && deviceIds.length > 0) queue(deviceIds, "locate");
    },
  };
};

export type PushSender = ReturnType<typeof createPushSender>;
