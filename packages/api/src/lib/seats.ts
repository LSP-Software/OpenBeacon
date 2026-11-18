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

const gracePeriodMs = 7 * 86_400_000;

export const seatAccountSelect = {
  seats: true,
  paidPeriodEndsAt: true,
  lastGracePeriodStartedAt: true,
} as const;

export const seatPeriod = (
  account: { seats: number; paidPeriodEndsAt: Date | null; lastGracePeriodStartedAt: Date | null },
  now: Date,
) => {
  const endedAt = account.paidPeriodEndsAt;
  if (!endedAt || now < endedAt) return { seats: account.seats, grace: null };
  const lastGrace = account.lastGracePeriodStartedAt;
  const sixMonthsBefore = new Date(endedAt);
  sixMonthsBefore.setUTCMonth(sixMonthsBefore.getUTCMonth() - 6);
  const graceGiven =
    !lastGrace || lastGrace.getTime() === endedAt.getTime() || lastGrace <= sixMonthsBefore;
  const endsAt = new Date(endedAt.getTime() + gracePeriodMs);
  return graceGiven && now < endsAt
    ? { seats: account.seats, grace: { startedAt: endedAt, endsAt } }
    : { seats: 0, grace: null };
};

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
  seatPeriod(
    await db.user.findUniqueOrThrow({ where: { id: userId }, select: seatAccountSelect }),
    new Date(),
  ).seats;

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
    select: { owner: { select: { id: true, name: true, ...seatAccountSelect } } },
  });
  const ownerSeats = seatPeriod(group.owner, new Date()).seats;
  const [inGroup, used] = await Promise.all([
    groupSeats(db, groupId),
    seatsEnforced({ selfHosted }) ? seatsUsed(db, group.owner.id) : null,
  ]);
  return {
    owner: { userId: group.owner.id, name: group.owner.name },
    seats: used === null ? null : ownerSeats,
    free: used === null ? null : Math.max(0, ownerSeats - used),
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

export const heldSeats = async ({
  db,
  ownerId,
  seats,
}: {
  db: RawDb;
  ownerId: string;
  seats: number | null;
}) => {
  const rows = await db.$queryRaw<Array<{ groupId: string; deviceId: string }>>(Prisma.sql`
    WITH "seat" AS (
      SELECT "member"."groupId", "device"."id" AS "deviceId",
        GREATEST("member"."createdAt", "device"."activatedAt") AS "takenAt"
      FROM "Group" AS "group"
      JOIN "GroupMember" AS "member" ON "member"."groupId" = "group"."id"
      ${activeDeviceJoin}
      WHERE "group"."ownerId" = ${ownerId}
    ), "ranked" AS (
      SELECT "groupId", "deviceId",
        row_number() OVER (ORDER BY "takenAt", "groupId", "deviceId") AS "ownerRank",
        row_number() OVER (PARTITION BY "groupId" ORDER BY "takenAt", "deviceId") AS "groupRank"
      FROM "seat"
    )
    SELECT "groupId", "deviceId" FROM "ranked"
    WHERE "groupRank" > ${limits.seatsPerGroup}
      OR (${seats !== null} AND "ownerRank" > ${seats ?? 0})
  `);
  const held = new Map<string, Set<string>>();
  for (const { groupId, deviceId } of rows) {
    held.set(groupId, (held.get(groupId) ?? new Set()).add(deviceId));
  }
  return held;
};

export const seatsEndingHolds = async ({
  db,
  ownerId,
  seats,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "userDevice">;
  ownerId: string;
  seats: number;
}) => {
  const [before, after] = await Promise.all([
    heldSeats({ db, ownerId, seats }),
    heldSeats({ db, ownerId, seats: 0 }),
  ]);
  const holds = [...after].flatMap(([groupId, deviceIds]) =>
    [...deviceIds]
      .filter((deviceId) => !before.get(groupId)?.has(deviceId))
      .map((deviceId) => ({ groupId, deviceId })),
  );
  if (holds.length === 0) return [];
  const [groups, devices] = await Promise.all([
    db.group.findMany({
      where: { id: { in: [...new Set(holds.map(({ groupId }) => groupId))] } },
      select: { id: true, name: true },
    }),
    db.userDevice.findMany({
      where: { id: { in: [...new Set(holds.map(({ deviceId }) => deviceId))] } },
      select: { id: true, name: true, user: { select: { id: true, name: true } } },
    }),
  ]);
  return holds
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
        a.memberName.localeCompare(b.memberName) ||
        a.deviceName.localeCompare(b.deviceName),
    );
};

export const createSeatHolds = ({
  db,
  selfHosted,
}: {
  db: RawDb & Pick<Prisma.TransactionClient, "group" | "groupMember" | "user">;
  selfHosted: boolean;
}) => {
  const owners = new Map<string, Promise<Map<string, Set<string>>>>();
  const groupOwners = new Map<string, Promise<string | null>>();
  const heldByOwner = (ownerId: string) => {
    const cached = owners.get(ownerId);
    if (cached) return cached;
    const held = (async () => {
      const seats = seatsEnforced({ selfHosted })
        ? seatPeriod(
            await db.user.findUniqueOrThrow({ where: { id: ownerId }, select: seatAccountSelect }),
            new Date(),
          ).seats
        : null;
      return heldSeats({ db, ownerId, seats });
    })();
    owners.set(ownerId, held);
    return held;
  };
  const ownerOf = (groupId: string) => {
    const cached = groupOwners.get(groupId);
    if (cached) return cached;
    const owner = db.group
      .findUnique({ where: { id: groupId }, select: { ownerId: true } })
      .then((group) => group?.ownerId ?? null);
    groupOwners.set(groupId, owner);
    return owner;
  };
  const heldIn = async (groupId: string, knownOwnerId?: string) => {
    const ownerId = knownOwnerId ?? (await ownerOf(groupId));
    if (!ownerId) return new Set<string>();
    return (await heldByOwner(ownerId)).get(groupId) ?? new Set<string>();
  };
  return {
    heldIn,
    isHeld: async (groupId: string, deviceId: string) => (await heldIn(groupId)).has(deviceId),
    heldGroupIds: async ({ deviceId, userId }: { deviceId: string; userId: string }) => {
      const memberships = await db.groupMember.findMany({
        where: { userId },
        select: { groupId: true, group: { select: { ownerId: true } } },
      });
      const held = await Promise.all(
        memberships.map(async ({ groupId, group }) =>
          (await heldIn(groupId, group.ownerId)).has(deviceId) ? groupId : null,
        ),
      );
      return held.filter((groupId) => groupId !== null);
    },
  };
};

export type SeatHolds = ReturnType<typeof createSeatHolds>;

export const assertNotOnHold = async (
  ctx: { deviceId: string; seatHolds: SeatHolds },
  groupId: string,
) => {
  if (await ctx.seatHolds.isHeld(groupId, ctx.deviceId)) throw seatOnHoldError();
};

export const seatOnHoldError = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message:
      "This phone is on hold in this group because the group's owner has no free seat for it.",
    cause: new ReasonError("SEAT_ON_HOLD"),
  });
