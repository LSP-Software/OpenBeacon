import {
  GroupEventType,
  type Prisma,
  type PrismaClient,
  readDatabaseTime,
} from "@openbeacon/database";
import type { groupHistoryCategorySchema } from "@openbeacon/schemas";
import type z from "zod";
import { HISTORY_RETENTION_MS } from "./historyShare.ts";
import { placeTransitionSelect, toPlaceTransitionView } from "./placeTransitions.ts";

const personSelect = { select: { id: true, name: true } } as const;

const categoryEventTypes = {
  arrivals: [],
  members: [
    GroupEventType.MEMBER_JOINED,
    GroupEventType.MEMBER_LEFT,
    GroupEventType.MEMBER_REMOVED,
    GroupEventType.ACCOUNT_DELETED,
    GroupEventType.LOCATION_UPDATE_REQUESTED,
  ],
  roles: [GroupEventType.ROLE_CHANGED],
  group: [
    GroupEventType.GROUP_CREATED,
    GroupEventType.GROUP_RENAMED,
    GroupEventType.GROUP_IMAGE_CHANGED,
  ],
  places: [GroupEventType.PLACE_ADDED, GroupEventType.PLACE_UPDATED, GroupEventType.PLACE_DELETED],
} satisfies Record<z.infer<typeof groupHistoryCategorySchema>, GroupEventType[]>;

export const groupEventSelect = {
  id: true,
  groupId: true,
  type: true,
  role: true,
  name: true,
  previousName: true,
  emoji: true,
  createdAt: true,
  actor: personSelect,
  subject: personSelect,
} as const;

export const toGroupEventView = (
  event: Prisma.GroupEventGetPayload<{ select: typeof groupEventSelect }>,
) => ({
  kind: "group" as const,
  id: event.id,
  at: event.createdAt,
  type: event.type,
  role: event.role,
  name: event.name,
  previousName: event.previousName,
  emoji: event.emoji,
  actor: event.actor ? { userId: event.actor.id, name: event.actor.name } : null,
  subject: event.subject ? { userId: event.subject.id, name: event.subject.name } : null,
});

export const recordGroupEvent = async (
  db: Prisma.TransactionClient,
  { data }: { data: Omit<Prisma.GroupEventUncheckedCreateInput, "id" | "createdAt"> },
) => db.groupEvent.create({ data: { ...data, createdAt: await readDatabaseTime(db) } });

export const readGroupHistory = async ({
  before,
  categories,
  db,
  groupId,
  limit = 100,
  memberSince,
  now,
}: {
  before: { at: Date; id: string } | undefined;
  categories: z.infer<typeof groupHistoryCategorySchema>[] | undefined;
  db: PrismaClient;
  groupId: string;
  limit?: number;
  memberSince: Date;
  now: Date;
}) => {
  const since = new Date(Math.max(now.getTime() - HISTORY_RETENTION_MS, memberSince.getTime()));
  const eventTypes = categories?.flatMap((category) => categoryEventTypes[category]);
  const includeArrivals = !categories || categories.includes("arrivals");
  const [events, transitions] = await Promise.all([
    eventTypes?.length === 0
      ? []
      : db.groupEvent.findMany({
          where: {
            groupId,
            ...(eventTypes ? { type: { in: eventTypes } } : {}),
            createdAt: { gte: since, ...(before ? { lte: before.at } : {}) },
            ...(before
              ? { OR: [{ createdAt: { lt: before.at } }, { id: { lt: before.id } }] }
              : {}),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit,
          select: groupEventSelect,
        }),
    !includeArrivals
      ? []
      : db.placeTransition.findMany({
          where: {
            groupId,
            occurredAt: { gte: since, ...(before ? { lte: before.at } : {}) },
            ...(before
              ? { OR: [{ occurredAt: { lt: before.at } }, { id: { lt: before.id } }] }
              : {}),
          },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: limit,
          select: placeTransitionSelect,
        }),
  ]);
  const items = [
    ...events.map(toGroupEventView),
    ...transitions.map((transition) => ({
      kind: "place" as const,
      at: transition.occurredAt,
      ...toPlaceTransitionView(transition),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const page = items.slice(0, limit);
  const last = page.at(-1);
  const more = items.length > limit || events.length === limit || transitions.length === limit;
  return {
    items: page,
    nextBefore: more && last ? { at: last.at, id: last.id } : null,
  };
};

export const readGroupHistoryLatest = async ({
  db,
  now,
  userId,
}: {
  db: PrismaClient;
  now: Date;
  userId: string;
}) =>
  db.$queryRaw<Array<{ groupId: string; latestAt: Date | null }>>`
    SELECT m."groupId", (
      SELECT max(e."createdAt") FROM "GroupEvent" e
      WHERE e."groupId" = m."groupId"
        AND e."createdAt" >= m."createdAt"
        AND e."createdAt" >= (${new Date(now.getTime() - HISTORY_RETENTION_MS).toISOString()}::timestamptz AT TIME ZONE 'UTC')
        AND COALESCE(e."actorUserId", e."subjectUserId") IS DISTINCT FROM ${userId}
        AND e."type" <> ${GroupEventType.LOCATION_UPDATE_REQUESTED}::"GroupEventType"
    ) AS "latestAt"
    FROM "GroupMember" m
    WHERE m."userId" = ${userId}
    ORDER BY m."groupId"
  `;
