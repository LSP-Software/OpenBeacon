import { groupNoticeSettings, noticeLookbackMs, noticeSettleMs } from "@openbeacon/auth/push.ts";
import { accountNoticeSettings } from "@openbeacon/auth/securityAlerts.ts";
import {
  type AccountNoticeType,
  GroupEventType,
  type PrismaClient,
  readDatabaseTime,
} from "@openbeacon/database";
import { groupEventSelect, toGroupEventView } from "./groupHistory.ts";
import { readNotificationSettings } from "./notificationSettings.ts";
import { decodeAlertsCursor, encodeAlertsCursor } from "./placeTransitions.ts";

export const readNotices = async ({
  cursor,
  db,
  deviceId,
  userId,
}: {
  cursor: string | null;
  db: PrismaClient;
  deviceId: string;
  userId: string;
}) => {
  const limit = 50;
  const now = await readDatabaseTime(db);
  const settledBefore = new Date(now.getTime() - noticeSettleMs);
  const oldestNotice = new Date(now.getTime() - noticeLookbackMs);
  const caughtUp = encodeAlertsCursor({ createdAt: settledBefore, id: "" });
  if (cursor === null) return { notices: [], cursor: caughtUp };
  const after = decodeAlertsCursor(cursor);
  if (after.createdAt >= settledBefore) return { notices: [], cursor };
  const phoneOnTypes = new Set(
    (await readNotificationSettings(db, userId)).flatMap(({ type, phone }) => (phone ? type : [])),
  );
  const accountTypes = (Object.keys(accountNoticeSettings) as AccountNoticeType[]).filter((type) =>
    phoneOnTypes.has(accountNoticeSettings[type]),
  );
  const groupTypes = (Object.keys(groupNoticeSettings) as (keyof typeof groupNoticeSettings)[])
    .filter((type) => phoneOnTypes.has(groupNoticeSettings[type]))
    .map((type) => GroupEventType[type]);
  const window = {
    createdAt: {
      gte: after.createdAt > oldestNotice ? after.createdAt : oldestNotice,
      lt: settledBefore,
    },
    OR: [{ createdAt: { gt: after.createdAt } }, { id: { gt: after.id } }],
  };
  const memberships =
    groupTypes.length > 0
      ? await db.groupMember.findMany({
          where: { userId },
          select: { groupId: true, createdAt: true },
        })
      : [];
  const [accountNotices, groupEvents] = await Promise.all([
    accountTypes.length > 0
      ? db.accountNotice.findMany({
          where: {
            ...window,
            userId,
            type: { in: accountTypes },
            AND: [{ OR: [{ excludeDeviceId: null }, { excludeDeviceId: { not: deviceId } }] }],
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
            createdAt: true,
          },
        })
      : [],
    memberships.length > 0
      ? db.groupEvent.findMany({
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
        })
      : [],
  ]);
  const notices = [
    ...accountNotices.map((notice) => ({
      kind: "account" as const,
      id: notice.id,
      at: notice.createdAt,
      type: notice.type,
      device:
        notice.deviceName === null && notice.deviceModel === null && notice.devicePlatform === null
          ? null
          : { name: notice.deviceName, model: notice.deviceModel, platform: notice.devicePlatform },
      deletionDate: notice.deletionDate,
    })),
    ...groupEvents.map((event) => ({ ...toGroupEventView(event), groupId: event.groupId })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
  const last = notices.at(-1);
  return {
    notices,
    cursor:
      last && notices.length === limit
        ? encodeAlertsCursor({ createdAt: last.at, id: last.id })
        : caughtUp,
  };
};
