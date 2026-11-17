import { groupNoticeSettings, noticeLookbackMs, noticeSettleMs } from "@openbeacon/auth/push.ts";
import { GroupEventType, type PrismaClient, readDatabaseTime } from "@openbeacon/database";
import { groupEventSelect, toGroupEventView } from "./groupHistory.ts";
import { readNotificationSettings } from "./notificationSettings.ts";
import { decodeAlertsCursor, encodeAlertsCursor } from "./placeTransitions.ts";

const readNoticePage = async <Notice extends { at: Date; id: string }>({
  cursor,
  db,
  read,
}: {
  cursor: string | null;
  db: PrismaClient;
  read: (
    window: {
      createdAt: { gte: Date; lt: Date };
      OR: [{ createdAt: { gt: Date } }, { id: { gt: string } }];
    },
    limit: number,
  ) => Promise<Notice[]>;
}): Promise<{ notices: Notice[]; cursor: string }> => {
  const limit = 50;
  const now = await readDatabaseTime(db);
  const settledBefore = new Date(now.getTime() - noticeSettleMs);
  const oldestNotice = new Date(now.getTime() - noticeLookbackMs);
  const caughtUp = encodeAlertsCursor({ createdAt: settledBefore, id: "" });
  if (cursor === null) return { notices: [], cursor: caughtUp };
  const after = decodeAlertsCursor(cursor);
  if (after.createdAt >= settledBefore) return { notices: [], cursor };
  const notices = await read(
    {
      createdAt: {
        gte: after.createdAt > oldestNotice ? after.createdAt : oldestNotice,
        lt: settledBefore,
      },
      OR: [{ createdAt: { gt: after.createdAt } }, { id: { gt: after.id } }],
    },
    limit,
  );
  const last = notices.at(-1);
  return {
    notices,
    cursor:
      last && notices.length === limit
        ? encodeAlertsCursor({ createdAt: last.at, id: last.id })
        : caughtUp,
  };
};

export const readAccountNotices = ({
  cursor,
  db,
  deviceId,
  sessionCreatedAt,
  userId,
}: {
  cursor: string | null;
  db: PrismaClient;
  deviceId: string;
  sessionCreatedAt: Date;
  userId: string;
}) =>
  readNoticePage({
    cursor,
    db,
    read: async (window, limit) =>
      (
        await db.accountNotice.findMany({
          where: {
            ...window,
            userId,
            AND: [
              { createdAt: { gte: sessionCreatedAt } },
              { OR: [{ excludeDeviceId: null }, { excludeDeviceId: { not: deviceId } }] },
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: limit,
          select: {
            id: true,
            type: true,
            deviceName: true,
            deviceModel: true,
            devicePlatform: true,
            deletionDate: true,
            turnedOffEmail: true,
            turnedOffPhone: true,
            createdAt: true,
          },
        })
      ).map((notice) => ({
        kind: "account" as const,
        id: notice.id,
        at: notice.createdAt,
        type: notice.type,
        device:
          notice.deviceName === null &&
          notice.deviceModel === null &&
          notice.devicePlatform === null
            ? null
            : {
                name: notice.deviceName,
                model: notice.deviceModel,
                platform: notice.devicePlatform,
              },
        deletionDate: notice.deletionDate,
        turnedOff: [
          ...notice.turnedOffPhone.map((type) => ({ type, channel: "phone" as const })),
          ...notice.turnedOffEmail.map((type) => ({ type, channel: "email" as const })),
        ],
      })),
  });

export const readGroupNotices = ({
  cursor,
  db,
  userId,
}: {
  cursor: string | null;
  db: PrismaClient;
  userId: string;
}) =>
  readNoticePage({
    cursor,
    db,
    read: async (window, limit) => {
      const phoneOnTypes = new Set(
        (await readNotificationSettings(db, userId)).flatMap(({ type, phone }) =>
          phone ? type : [],
        ),
      );
      const groupTypes = (Object.keys(groupNoticeSettings) as (keyof typeof groupNoticeSettings)[])
        .filter((type) => phoneOnTypes.has(groupNoticeSettings[type]))
        .map((type) => GroupEventType[type]);
      if (groupTypes.length === 0) return [];
      const memberships = await db.groupMember.findMany({
        where: { userId },
        select: { groupId: true, createdAt: true },
      });
      if (memberships.length === 0) return [];
      const events = await db.groupEvent.findMany({
        where: {
          ...window,
          type: { in: groupTypes },
          AND: [
            {
              OR: [
                { type: { not: GroupEventType.MEMBER_JOINED } },
                { subjectUserId: null },
                { subjectUserId: { not: userId } },
              ],
            },
            { OR: [{ actorUserId: null }, { actorUserId: { not: userId } }] },
            {
              OR: memberships.map(({ groupId, createdAt }) => ({
                groupId,
                createdAt: { gt: createdAt },
              })),
            },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
        select: groupEventSelect,
      });
      return events.map((event) => ({ ...toGroupEventView(event), groupId: event.groupId }));
    },
  });
