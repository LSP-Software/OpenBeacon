import { Prisma } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";
import { limits } from "./limits.ts";
import { ReasonError } from "./reasonError.ts";

type RawDb = Pick<Prisma.TransactionClient, "$queryRaw">;

const activeDeviceJoin = Prisma.sql`
  JOIN "UserDevice" AS "device"
    ON "device"."userId" = "member"."userId"
    AND "device"."activatedAt" IS NOT NULL
    AND "device"."revokedAt" IS NULL`;

const countSeats = async (db: RawDb, groupIds: Prisma.Sql) => {
  const [row] = await db.$queryRaw<[{ used: number }]>(Prisma.sql`
    SELECT count(*)::int AS "used"
    FROM "GroupMember" AS "member"
    ${activeDeviceJoin}
    WHERE "member"."groupId" IN (${groupIds})
  `);
  return row.used;
};

export const accountSeats = async (db: Pick<Prisma.TransactionClient, "user">, userId: string) =>
  (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { seats: true } })).seats;

export const seatsUsed = (db: RawDb, userId: string) =>
  countSeats(db, Prisma.sql`SELECT "id" FROM "Group" WHERE "ownerId" = ${userId}`);

export const groupSeats = (db: RawDb, groupId: string) => countSeats(db, Prisma.sql`${groupId}`);

export const activatedDevices = (
  db: Pick<Prisma.TransactionClient, "userDevice">,
  userId: string,
) => db.userDevice.count({ where: { userId, activatedAt: { not: null }, revokedAt: null } });

export const seatsEnforced = ({ selfHosted }: { selfHosted: boolean }) => !selfHosted;

export const seatCount = (count: number) => `${count} ${count === 1 ? "seat" : "seats"}`;

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
    message: `This group is full. A group can have up to ${limits.seatsPerGroup} phones.`,
    cause: new ReasonError("GROUP_FULL"),
  });

export const groupSeatState = async ({
  db,
  groupId,
  selfHosted,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group">;
  groupId: string;
  selfHosted: boolean;
}) => {
  const group = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { owner: { select: { id: true, name: true, seats: true } } },
  });
  const [inGroup, used] = await Promise.all([
    groupSeats(db, groupId),
    seatsEnforced({ selfHosted }) ? seatsUsed(db, group.owner.id) : null,
  ]);
  return {
    owner: { userId: group.owner.id, name: group.owner.name },
    seats: used === null ? null : group.owner.seats,
    free: used === null ? null : Math.max(0, group.owner.seats - used),
    groupSeats: inGroup,
    seatsPerGroup: limits.seatsPerGroup,
  };
};

export const joinBlockedBy = ({
  free,
  groupSeats,
  needed,
}: {
  free: number | null;
  groupSeats: number;
  needed: number;
}) =>
  groupSeats + needed > limits.seatsPerGroup
    ? ("GROUP_FULL" as const)
    : free !== null && needed > free
      ? ("NO_FREE_SEATS" as const)
      : null;

export const assertRoomToInvite = async ({
  db,
  groupId,
  selfHosted,
  userId,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group">;
  groupId: string;
  selfHosted: boolean;
  userId: string;
}) => {
  const state = await groupSeatState({ db, groupId, selfHosted });
  const blockedBy = joinBlockedBy({ free: state.free, groupSeats: state.groupSeats, needed: 1 });
  if (blockedBy === "GROUP_FULL") throw groupFullError();
  if (blockedBy !== "NO_FREE_SEATS") return;
  throw noFreeSeatsError(noFreeSeatsToInviteMessage({ ...state, userId }));
};

export const noFreeSeatsToInviteMessage = ({
  owner,
  seats,
  userId,
}: {
  owner: { name: string; userId: string };
  seats: number | null;
  userId: string;
}) => {
  const count = seats ?? 0;
  if (owner.userId === userId) {
    const using =
      count === 0
        ? "You have no seats."
        : count === 1
          ? "You're using your only seat."
          : `You're using all ${count} of your seats.`;
    return `${using} Add seats or remove someone to invite more people.`;
  }
  const using =
    count === 0
      ? "has no seats"
      : count === 1
        ? "is using their only seat"
        : `is using all ${count} of their seats`;
  return `${owner.name} owns this group and ${using}. Ask ${owner.name} to add seats or to remove someone.`;
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
    });
  }
  return group.ownerId;
};

export const assertRoomToJoin = async ({
  db,
  groupId,
  joinerId,
  selfHosted,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "userDevice">;
  groupId: string;
  joinerId: string;
  selfHosted: boolean;
}) => {
  const [state, needed] = await Promise.all([
    groupSeatState({ db, groupId, selfHosted }),
    activatedDevices(db, joinerId),
  ]);
  const blockedBy = joinBlockedBy({ free: state.free, groupSeats: state.groupSeats, needed });
  if (blockedBy === "GROUP_FULL") throw groupFullError();
  if (blockedBy === "NO_FREE_SEATS") {
    throw noFreeSeatsError(
      `This group has no free seats for your phones. You need ${seatCount(needed)} and ${state.free} ${state.free === 1 ? "is" : "are"} free. Ask ${state.owner.name} to add seats.`,
    );
  }
};

export const heldDeviceIds = async ({
  db,
  groupId,
  selfHosted,
}: {
  db: RawDb;
  groupId: string;
  selfHosted: boolean;
}) => {
  const rows = await db.$queryRaw<Array<{ deviceId: string }>>(Prisma.sql`
    WITH "owner" AS (
      SELECT "account"."id", "account"."seats"
      FROM "Group" AS "group"
      JOIN "User" AS "account" ON "account"."id" = "group"."ownerId"
      WHERE "group"."id" = ${groupId}
    ), "seat" AS (
      SELECT "member"."groupId", "device"."id" AS "deviceId",
        GREATEST("member"."createdAt", "device"."activatedAt") AS "takenAt"
      FROM "Group" AS "group"
      JOIN "GroupMember" AS "member" ON "member"."groupId" = "group"."id"
      ${activeDeviceJoin}
      WHERE "group"."ownerId" = (SELECT "id" FROM "owner")
    ), "ranked" AS (
      SELECT "groupId", "deviceId",
        row_number() OVER (ORDER BY "takenAt", "groupId", "deviceId") AS "ownerRank",
        row_number() OVER (PARTITION BY "groupId" ORDER BY "takenAt", "deviceId") AS "groupRank"
      FROM "seat"
    )
    SELECT "deviceId" FROM "ranked"
    WHERE "groupId" = ${groupId}
      AND ("groupRank" > ${limits.seatsPerGroup}
        OR (${seatsEnforced({ selfHosted })} AND "ownerRank" > (SELECT "seats" FROM "owner")))
  `);
  return new Set(rows.map(({ deviceId }) => deviceId));
};

export const seatOnHoldError = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message:
      "This phone is on hold in this group because the group's owner has no free seat for it.",
    cause: new ReasonError("SEAT_ON_HOLD"),
  });
