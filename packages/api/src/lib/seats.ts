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

export const seatAccountSelect = { seats: true, paidPeriodEndsAt: true } as const;

export const currentSeats = (
  account: { seats: number; paidPeriodEndsAt: Date | null },
  now: Date,
) => (account.paidPeriodEndsAt && account.paidPeriodEndsAt <= now ? 0 : account.seats);

const perGroup = Prisma.raw(String(limits.seatsPerGroup));

const countSeats = async (db: RawDb, groupIds: Prisma.Sql) => {
  const [row] = await db.$queryRaw<[{ used: number }]>(Prisma.sql`
    SELECT coalesce(sum(least("inGroup"."count", ${perGroup})), 0)::int AS "used"
    FROM (
      SELECT count(*) AS "count"
      FROM "GroupMember" AS "member"
      ${activeDeviceJoin}
      WHERE "member"."groupId" IN (${groupIds})
      GROUP BY "member"."groupId"
    ) AS "inGroup"
  `);
  return row.used;
};

const accountSeats = async (db: Pick<Prisma.TransactionClient, "user">, userId: string) =>
  currentSeats(
    await db.user.findUniqueOrThrow({ where: { id: userId }, select: seatAccountSelect }),
    new Date(),
  );

export const seatsUsed = (db: RawDb, userId: string) =>
  countSeats(db, Prisma.sql`SELECT "id" FROM "Group" WHERE "ownerId" = ${userId}`);

export const freeSeats = async (
  db: RawDb & Pick<Prisma.TransactionClient, "user">,
  userId: string,
) => {
  const [seats, used] = await Promise.all([accountSeats(db, userId), seatsUsed(db, userId)]);
  return { seats, used, free: Math.max(0, seats - used) };
};

export const groupSeats = (db: RawDb, groupId: string) => countSeats(db, Prisma.sql`${groupId}`);

export const activatedDevices = (
  db: Pick<Prisma.TransactionClient, "userDevice">,
  userId: string,
) => db.userDevice.count({ where: { userId, activatedAt: { not: null }, revokedAt: null } });

export const seatsEnforced = ({ selfHosted }: { selfHosted: boolean }) => !selfHosted;

export const seatCount = (count: number) => `${count} ${count === 1 ? "seat" : "seats"}`;

export const freeSeatCount = (free: number) =>
  free === 0 ? "no free seats" : `${free} free ${free === 1 ? "seat" : "seats"}`;

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
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "user">;
  groupId: string;
  selfHosted: boolean;
}) => {
  const group = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { owner: { select: { id: true, name: true } } },
  });
  const [inGroup, owner] = await Promise.all([
    groupSeats(db, groupId),
    seatsEnforced({ selfHosted }) ? freeSeats(db, group.owner.id) : null,
  ]);
  return {
    owner: { userId: group.owner.id, name: group.owner.name },
    seats: owner?.seats ?? null,
    used: owner?.used ?? null,
    free: owner?.free ?? null,
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
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "user">;
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
  used,
  userId,
}: {
  owner: { name: string; userId: string };
  seats: number | null;
  used: number | null;
  userId: string;
}) => {
  if (owner.userId !== userId) {
    return `${owner.name} owns this group and has no free seats. Ask ${owner.name} to add seats or to remove someone.`;
  }
  const count = seats ?? 0;
  const inUse = used ?? 0;
  const using =
    count === 0
      ? "You have no seats."
      : inUse > count
        ? `You're using ${seatCount(inUse)} but have ${count}.`
        : count === 1
          ? "You're using your only seat."
          : `You're using all ${count} of your seats.`;
  return `${using} Add seats or remove someone to invite more people.`;
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

export const assertRoomToJoin = async ({
  db,
  groupId,
  joinerId,
  selfHosted,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "user" | "userDevice">;
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
      `This group has no free seats for your phones. Ask ${state.owner.name} to add seats.`,
    );
  }
};

const rankSeats = async ({
  db,
  enforced,
  now,
  owners,
  where = Prisma.sql`TRUE`,
}: {
  db: RawDb;
  enforced: boolean;
  now: Date;
  owners: Prisma.Sql;
  where?: Prisma.Sql;
}) => {
  const rows = await db.$queryRaw<
    Array<{
      ownerId: string;
      groupId: string;
      userId: string;
      deviceId: string;
      ownerRank: number | null;
      seats: number;
      paidPeriodEndsAt: Date | null;
    }>
  >(Prisma.sql`
    WITH "seat" AS (
      SELECT "group"."ownerId", "member"."groupId", "member"."userId", "device"."id" AS "deviceId",
        GREATEST("member"."createdAt", "device"."activatedAt") AS "takenAt"
      FROM "Group" AS "group"
      JOIN "GroupMember" AS "member" ON "member"."groupId" = "group"."id"
      ${activeDeviceJoin}
      WHERE "group"."ownerId" IN (${owners})
    ), "inGroup" AS (
      SELECT *, row_number() OVER (PARTITION BY "groupId" ORDER BY "takenAt", "deviceId") AS "groupRank"
      FROM "seat"
    ), "ranked" AS (
      SELECT *, (CASE WHEN "groupRank" <= ${perGroup} THEN row_number() OVER (
        PARTITION BY "ownerId", "groupRank" <= ${perGroup}
        ORDER BY "takenAt", "groupId", "deviceId"
      ) END)::int AS "ownerRank"
      FROM "inGroup"
    )
    SELECT "ranked"."ownerId", "ranked"."groupId", "ranked"."userId", "ranked"."deviceId",
      "ranked"."ownerRank", "owner"."seats", "owner"."paidPeriodEndsAt"
    FROM "ranked"
    JOIN "User" AS "owner" ON "owner"."id" = "ranked"."ownerId"
    WHERE ${where}
    ORDER BY "ranked"."ownerId", "ranked"."groupId", "ranked"."groupRank"
  `);
  return rows.map(({ ownerId, groupId, userId, deviceId, ownerRank, ...owner }) => {
    const seats = enforced ? currentSeats(owner, now) : null;
    return {
      ownerId,
      groupId,
      userId,
      deviceId,
      overGroupLimit: ownerRank === null,
      held: ownerRank === null || (seats !== null && ownerRank > seats),
    };
  });
};

const rankGroups = async ({
  db,
  enforced,
  groupIds,
  now,
}: {
  db: RawDb;
  enforced: boolean;
  groupIds: Prisma.Sql;
  now: Date;
}) => {
  const full = enforced
    ? null
    : await db.$queryRaw<Array<{ groupId: string }>>(Prisma.sql`
        SELECT "member"."groupId"
        FROM "GroupMember" AS "member"
        ${activeDeviceJoin}
        WHERE "member"."groupId" IN (${groupIds})
        GROUP BY "member"."groupId"
        HAVING count(*) > ${perGroup}
      `);
  if (full?.length === 0) return [];
  const groups = full ? Prisma.join(full.map(({ groupId }) => groupId)) : groupIds;
  return rankSeats({
    db,
    enforced,
    now,
    owners: Prisma.sql`SELECT "ownerId" FROM "Group" WHERE "id" IN (${groups})`,
    where: Prisma.sql`"ranked"."groupId" IN (${groups})`,
  });
};

export const heldSeatDevices = async ({
  db,
  groupIds,
  selfHosted,
}: {
  db: RawDb;
  groupIds: string[];
  selfHosted: boolean;
}) =>
  groupIds.length === 0
    ? []
    : (
        await rankGroups({
          db,
          enforced: seatsEnforced({ selfHosted }),
          groupIds: Prisma.join([...new Set(groupIds)]),
          now: new Date(),
        })
      )
        .filter(({ held }) => held)
        .map(({ groupId, deviceId }) => ({ groupId, deviceId }));

export const seatsEndedHolds = async ({
  db,
  endedAt,
  ownerId,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "userDevice">;
  endedAt: Date;
  ownerId: string;
}) => {
  const seated = (
    await rankSeats({
      db,
      enforced: true,
      now: new Date(endedAt.getTime() - 1),
      owners: Prisma.sql`${ownerId}`,
    })
  ).filter(({ held }) => !held);
  if (seated.length === 0) return [];
  const [groups, devices] = await Promise.all([
    db.group.findMany({
      where: { id: { in: [...new Set(seated.map(({ groupId }) => groupId))] } },
      select: { id: true, name: true },
    }),
    db.userDevice.findMany({
      where: { id: { in: seated.map(({ deviceId }) => deviceId) } },
      select: { id: true, name: true, user: { select: { id: true, name: true } } },
    }),
  ]);
  return seated
    .flatMap(({ groupId, deviceId }) => {
      const group = groups.find(({ id }) => id === groupId);
      const device = devices.find(({ id }) => id === deviceId);
      return group && device
        ? [
            {
              groupId,
              groupName: group.name,
              userId: device.user.id,
              memberName: device.user.name,
              deviceId,
              deviceName: device.name,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName) ||
        a.groupId.localeCompare(b.groupId) ||
        a.memberName.localeCompare(b.memberName) ||
        a.deviceName.localeCompare(b.deviceName),
    );
};

export const createSeatHolds = ({
  db,
  selfHosted,
  userId,
}: {
  db: RawDb;
  selfHosted: boolean;
  userId: string;
}) => {
  let ranking: ReturnType<typeof rankGroups> | null = null;
  const seats = () => {
    ranking ??= rankGroups({
      db,
      enforced: seatsEnforced({ selfHosted }),
      groupIds: Prisma.sql`SELECT "groupId" FROM "GroupMember" WHERE "userId" = ${userId}`,
      now: new Date(),
    });
    return ranking;
  };
  const heldIn = async (groupId: string) =>
    new Set(
      (await seats())
        .filter((seat) => seat.groupId === groupId && seat.held)
        .map(({ deviceId }) => deviceId),
    );
  return {
    ownSeats: async () => (await seats()).filter((seat) => seat.ownerId === userId),
    heldIn,
    isHeld: async (groupId: string, deviceId: string) => (await heldIn(groupId)).has(deviceId),
    heldGroupIds: async (deviceId: string) =>
      (await seats())
        .filter((seat) => seat.deviceId === deviceId && seat.held)
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
    message:
      "This phone is on hold in this group because the group's owner has no free seat for it.",
    cause: new ReasonError("SEAT_ON_HOLD"),
  });
