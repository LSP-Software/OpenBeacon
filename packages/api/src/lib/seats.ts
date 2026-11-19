import { Prisma } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";
import { limits } from "./limits.ts";
import { ReasonError } from "./reasonError.ts";

type RawDb = Pick<Prisma.TransactionClient, "$queryRaw">;

export const seatsEnforced = ({ selfHosted }: { selfHosted: boolean }) => !selfHosted;

export const seatsUsed = async (db: RawDb, ownerId: string) => {
  const [row] = await db.$queryRaw<[{ used: number }]>(Prisma.sql`
    SELECT count(DISTINCT "member"."userId")::int AS "used"
    FROM "GroupMember" AS "member"
    JOIN "Group" AS "group" ON "group"."id" = "member"."groupId"
    WHERE "group"."ownerId" = ${ownerId}
  `);
  return row.used;
};

export const freeSeats = async (
  db: RawDb & Pick<Prisma.TransactionClient, "user">,
  userId: string,
) => {
  const [account, used] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { seats: true } }),
    seatsUsed(db, userId),
  ]);
  return { seats: account.seats, used, free: Math.max(0, account.seats - used) };
};

export const newPeopleFor = async ({
  db,
  groupId,
  ownerId,
}: {
  db: RawDb;
  groupId: string;
  ownerId: string;
}) => {
  const [row] = await db.$queryRaw<[{ count: number }]>(Prisma.sql`
    SELECT count(*)::int AS "count"
    FROM "GroupMember" AS "member"
    WHERE "member"."groupId" = ${groupId}
      AND NOT EXISTS (
        SELECT 1
        FROM "GroupMember" AS "other"
        JOIN "Group" AS "group" ON "group"."id" = "other"."groupId"
        WHERE "other"."userId" = "member"."userId" AND "group"."ownerId" = ${ownerId}
      )
  `);
  return row.count;
};

export const isOneOfOwnersPeople = async ({
  db,
  ownerId,
  userId,
}: {
  db: Pick<Prisma.TransactionClient, "groupMember">;
  ownerId: string;
  userId: string;
}) => (await db.groupMember.count({ where: { userId, group: { ownerId } } })) > 0;

export const lockAccounts = async (db: RawDb, userIds: string[]) => {
  const ids = [...new Set(userIds)].sort();
  if (ids.length === 0) return;
  await db.$queryRaw(
    Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR NO KEY UPDATE`,
  );
};

export const noFreeSeatsError = (message: string) =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message,
    cause: new ReasonError("NO_FREE_SEATS"),
  });

export const groupFullError = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `This group is full. A group can have up to ${limits.peoplePerGroup} people.`,
    cause: new ReasonError("GROUP_FULL"),
  });

export const groupSeatState = async ({
  db,
  groupId,
  joinerId = null,
  selfHosted,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "groupMember" | "user">;
  groupId: string;
  joinerId?: string | null;
  selfHosted: boolean;
}) => {
  const group = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    select: {
      owner: { select: { id: true, name: true } },
      _count: { select: { groupMembers: true } },
    },
  });
  const [owner, joinerHasSeat] = await Promise.all([
    seatsEnforced({ selfHosted }) ? freeSeats(db, group.owner.id) : null,
    joinerId === null
      ? false
      : isOneOfOwnersPeople({ db, ownerId: group.owner.id, userId: joinerId }),
  ]);
  const needed = owner === null || joinerHasSeat ? 0 : 1;
  return {
    owner: { userId: group.owner.id, name: group.owner.name },
    seats: owner?.seats ?? null,
    used: owner?.used ?? null,
    needed,
    blockedBy:
      group._count.groupMembers >= limits.peoplePerGroup
        ? ("GROUP_FULL" as const)
        : owner !== null && needed > owner.free
          ? ("NO_FREE_SEATS" as const)
          : null,
  };
};

export const noFreeSeatsToInviteMessage = ({
  owner,
  seats,
  used,
  userId,
}: {
  owner: { name: string; userId: string };
  seats: number | null;
  used: number | null;
  userId: string;
}) => {
  if (owner.userId !== userId) {
    return `${owner.name} owns this group and has no room for more people. Ask ${owner.name} to add room or to remove someone.`;
  }
  const count = seats ?? 0;
  const inUse = used ?? 0;
  if (count === 0) return "You have no room for people. Add room to invite people.";
  if (inUse > count) {
    return `You have room for ${count} ${count === 1 ? "person" : "people"} but ${inUse} are in your groups. Add room or remove someone to invite more people.`;
  }
  if (count === 1) return "You have room for 1 person and that's you. Add room to invite people.";
  return `You have room for ${count} people and they're all in your groups. Add room or remove someone to invite more people.`;
};

export const assertRoomToInvite = async ({
  db,
  groupId,
  selfHosted,
  userId,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "groupMember" | "user">;
  groupId: string;
  selfHosted: boolean;
  userId: string;
}) => {
  const state = await groupSeatState({ db, groupId, selfHosted });
  if (state.blockedBy === "GROUP_FULL") throw groupFullError();
  if (state.blockedBy === "NO_FREE_SEATS") {
    throw noFreeSeatsError(noFreeSeatsToInviteMessage({ ...state, userId }));
  }
};

export const assertRoomToJoin = async ({
  db,
  groupId,
  joinerId,
  selfHosted,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "groupMember" | "user">;
  groupId: string;
  joinerId: string;
  selfHosted: boolean;
}) => {
  const state = await groupSeatState({ db, groupId, joinerId, selfHosted });
  if (state.blockedBy === "GROUP_FULL") throw groupFullError();
  if (state.blockedBy === "NO_FREE_SEATS") {
    throw noFreeSeatsError(`This group has no room for you. Ask ${state.owner.name} to make room.`);
  }
};

export const lockOwnerThenGroup = async ({
  db,
  groupId,
  userIds,
}: {
  db: RawDb;
  groupId: string;
  userIds: string[];
}) => {
  const [before] = await db.$queryRaw<Array<{ ownerId: string }>>(
    Prisma.sql`SELECT "ownerId" FROM "Group" WHERE id = ${groupId}`,
  );
  if (!before) return null;
  await lockAccounts(db, [...userIds, before.ownerId]);
  const [group] = await db.$queryRaw<Array<{ ownerId: string }>>(
    Prisma.sql`SELECT "ownerId" FROM "Group" WHERE id = ${groupId} FOR UPDATE`,
  );
  if (!group) return null;
  if (group.ownerId !== before.ownerId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This group's owner has just changed. Try again.",
      cause: new ReasonError("GROUP_OWNER_CHANGED"),
    });
  }
  return group.ownerId;
};

const rankPeople = ({ db, groupIds }: { db: RawDb; groupIds: Prisma.Sql }) =>
  db.$queryRaw<
    Array<{
      ownerId: string;
      groupId: string;
      userId: string;
      rank: number;
      held: boolean;
      heldDeviceIds: string[];
    }>
  >(Prisma.sql`
      WITH "owned" AS (
        SELECT "group"."ownerId", "member"."groupId", "member"."userId", "member"."createdAt"
        FROM "Group" AS "group"
        JOIN "GroupMember" AS "member" ON "member"."groupId" = "group"."id"
        WHERE "group"."ownerId" IN (SELECT "ownerId" FROM "Group" WHERE "id" IN (${groupIds}))
      ), "person" AS (
        SELECT "ownerId", "userId", row_number() OVER (
          PARTITION BY "ownerId"
          ORDER BY "userId" = "ownerId" DESC, min("createdAt"), "userId"
        )::int AS "rank"
        FROM "owned"
        GROUP BY "ownerId", "userId"
      )
      SELECT "owned"."ownerId", "owned"."groupId", "owned"."userId", "person"."rank",
        "person"."rank" > "owner"."seats" AS "held",
        CASE WHEN "person"."rank" > "owner"."seats" THEN ARRAY(
          SELECT "device"."id"
          FROM "UserDevice" AS "device"
          WHERE "device"."userId" = "owned"."userId"
            AND "device"."activatedAt" IS NOT NULL
            AND "device"."revokedAt" IS NULL
          ORDER BY "device"."id"
        ) ELSE ARRAY[]::text[] END AS "heldDeviceIds"
      FROM "owned"
      JOIN "person" ON "person"."ownerId" = "owned"."ownerId" AND "person"."userId" = "owned"."userId"
      JOIN "User" AS "owner" ON "owner"."id" = "owned"."ownerId"
      WHERE "owned"."groupId" IN (${groupIds})
      ORDER BY "owned"."ownerId", "owned"."groupId", "person"."rank"
    `);

const heldDevicesOf = (people: Awaited<ReturnType<typeof rankPeople>>) =>
  people.flatMap(({ groupId, heldDeviceIds }) =>
    heldDeviceIds.map((deviceId) => ({ groupId, deviceId })),
  );

export const heldSeatDevices = async ({
  db,
  groupIds,
  selfHosted,
}: {
  db: RawDb;
  groupIds: string[];
  selfHosted: boolean;
}) =>
  groupIds.length === 0 || !seatsEnforced({ selfHosted })
    ? []
    : heldDevicesOf(await rankPeople({ db, groupIds: Prisma.join([...new Set(groupIds)]) }));

export const createSeatHolds = ({
  db,
  selfHosted,
  userId,
}: {
  db: RawDb;
  selfHosted: boolean;
  userId: string;
}) => {
  let ranking: ReturnType<typeof rankPeople> | null = null;
  const people = async () => {
    if (!seatsEnforced({ selfHosted })) return [];
    ranking ??= rankPeople({
      db,
      groupIds: Prisma.sql`SELECT "groupId" FROM "GroupMember" WHERE "userId" = ${userId}`,
    });
    return ranking;
  };
  const heldIn = async (groupId: string) =>
    new Set(
      heldDevicesOf((await people()).filter((person) => person.groupId === groupId)).map(
        ({ deviceId }) => deviceId,
      ),
    );
  return {
    people,
    heldIn,
    isHeld: async (groupId: string, deviceId: string) => (await heldIn(groupId)).has(deviceId),
    heldGroupIds: async (deviceId: string) =>
      (await people())
        .filter(({ heldDeviceIds }) => heldDeviceIds.includes(deviceId))
        .map(({ groupId }) => groupId),
  };
};

export type SeatHolds = ReturnType<typeof createSeatHolds>;

export const assertNotOnHold = async (
  ctx: { deviceId: string; seatHolds: SeatHolds },
  groupId: string,
) => {
  if (await ctx.seatHolds.isHeld(groupId, ctx.deviceId)) throw seatOnHoldError();
};

const seatOnHoldError = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "You're on hold in this group until its owner has room for you.",
    cause: new ReasonError("SEAT_ON_HOLD"),
  });
