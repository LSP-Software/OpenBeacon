import type { PrismaClient } from "@openbeacon/database";
import { limits, maxAccountSeats } from "./limits.ts";
import { seatAccountSelect, seatPeriod, seatsEnforced, type SeatHolds } from "./seats.ts";

type Unit = { one: string; other: string };

export const readAccountUsage = async ({
  allowSelfSetSeats,
  db,
  deviceId,
  now,
  seatHolds,
  selfHosted,
  userId,
}: {
  allowSelfSetSeats: boolean;
  db: PrismaClient;
  deviceId: string;
  now: Date;
  seatHolds: SeatHolds;
  selfHosted: boolean;
  userId: string;
}) => {
  const enforced = seatsEnforced({ selfHosted });
  const [account, memberships, ownPhones, ownSeats] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: seatAccountSelect }),
    db.groupMember.findMany({
      where: { userId },
      select: {
        group: {
          select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } },
        },
      },
    }),
    db.userDevice.findMany({
      where: { userId, activatedAt: { not: null }, revokedAt: null },
      select: { id: true, name: true },
    }),
    enforced ? seatHolds.ownSeats() : Promise.resolve([]),
  ]);
  const period = seatPeriod(account, now);
  const seatDevices = await db.userDevice.findMany({
    where: { id: { in: ownSeats.map(({ deviceId }) => deviceId) } },
    select: { id: true, name: true, user: { select: { name: true } } },
  });

  const groups = await Promise.all(
    memberships.map(async ({ group }) => {
      const held = await seatHolds.heldIn(group.id);
      const isOwner = group.ownerId === userId;
      const phones =
        enforced && isOwner
          ? ownSeats
              .filter((seat) => seat.groupId === group.id)
              .flatMap((seat) => {
                const device = seatDevices.find(({ id }) => id === seat.deviceId);
                return device
                  ? [
                      {
                        deviceId: seat.deviceId,
                        deviceName: device.name,
                        userId: seat.userId,
                        memberName: device.user.name,
                        isThisPhone: seat.deviceId === deviceId,
                        onHold: seat.held,
                        holdsFrom: period.grace && !seat.held ? period.grace.endsAt : null,
                      },
                    ]
                  : [];
              })
          : null;
      return {
        id: group.id,
        name: group.name,
        owner: { userId: group.ownerId, name: group.owner.name },
        isOwner,
        seats: phones && {
          used: Math.min(phones.length, limits.seatsPerGroup),
          max: limits.seatsPerGroup,
          onHold: phones.filter(({ onHold }) => onHold).length,
          phones,
        },
        yourPhonesOnHold: ownPhones
          .filter((phone) => held.has(phone.id))
          .map((phone) => ({
            deviceId: phone.id,
            deviceName: phone.name,
            isThisPhone: phone.id === deviceId,
          })),
      };
    }),
  );
  groups.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));

  const seatsUsed = ownSeats.filter(({ overGroupLimit }) => !overGroupLimit).length;
  const seatsOnHold = ownSeats.filter(({ held, overGroupLimit }) => held && !overGroupLimit).length;
  const gauges: Array<{
    id: string;
    label: string;
    used: number;
    max: number;
    onHold: number;
    unit: Unit;
  }> = [
    ...(enforced
      ? [
          {
            id: "seats",
            label: "Seats",
            used: seatsUsed,
            max: period.seats,
            onHold: seatsOnHold,
            unit: { one: "seat", other: "seats" },
          },
        ]
      : []),
    {
      id: "groups",
      label: "Groups",
      used: memberships.length,
      max: limits.groupsPerAccount,
      onHold: 0,
      unit: { one: "group", other: "groups" },
    },
    {
      id: "devices",
      label: "Devices",
      used: ownPhones.length,
      max: limits.devicesPerAccount,
      onHold: 0,
      unit: { one: "device", other: "devices" },
    },
  ];

  const usageLimits: Array<{
    id: string;
    label: string;
    value: number;
    unit: Unit;
  }> = [
    {
      id: "history",
      label: "Location history kept",
      value: limits.historyDays,
      unit: { one: "day", other: "days" },
    },
  ];

  return {
    gauges,
    limits: usageLimits,
    seats: enforced
      ? {
          seats: period.seats,
          paidSeats: account.seats,
          used: seatsUsed,
          onHold: seatsOnHold,
          max: maxAccountSeats,
          selfSetAllowed: allowSelfSetSeats,
          paidPeriodEndsAt: account.paidPeriodEndsAt,
          graceEndsAt: period.grace?.endsAt ?? null,
        }
      : null,
    groups,
  };
};
