import type { PrismaClient } from "@openbeacon/database";
import { limits, maxAccountSeats } from "./limits.ts";
import {
  seatAccountSelect,
  seatPeriod,
  seatsEndingHolds,
  seatsEnforced,
  type SeatHolds,
} from "./seats.ts";

const unit = (one: string, other: string) => ({ one, other });

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
  const [account, memberships, ownPhones] = await Promise.all([
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
  ]);
  const period = seatPeriod(account, now);
  const ownedGroupIds = enforced
    ? memberships.filter(({ group }) => group.ownerId === userId).map(({ group }) => group.id)
    : [];
  const [seatRows, graceHolds] = await Promise.all([
    db.groupMember.findMany({
      where: { groupId: { in: ownedGroupIds } },
      select: {
        groupId: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            devices: {
              where: { activatedAt: { not: null }, revokedAt: null },
              select: { id: true, name: true, activatedAt: true },
            },
          },
        },
      },
    }),
    enforced && period.grace
      ? seatsEndingHolds({ db, ownerId: userId, seats: period.seats })
      : Promise.resolve([]),
  ]);
  const holdsFrom = (groupId: string, phoneId: string) =>
    period.grace && graceHolds.some((hold) => hold.groupId === groupId && hold.deviceId === phoneId)
      ? period.grace.endsAt
      : null;

  const groups = await Promise.all(
    memberships.map(async ({ group }) => {
      const held = await seatHolds.heldIn(group.id, group.ownerId);
      const isOwner = group.ownerId === userId;
      const phones = ownedGroupIds.includes(group.id)
        ? seatRows
            .filter((row) => row.groupId === group.id)
            .flatMap((row) =>
              row.user.devices.map((phone) => ({
                takenAt: Math.max(row.createdAt.getTime(), phone.activatedAt?.getTime() ?? 0),
                deviceId: phone.id,
                deviceName: phone.name,
                userId: row.user.id,
                memberName: row.user.name,
                isThisPhone: phone.id === deviceId,
                onHold: held.has(phone.id),
                holdsFrom: holdsFrom(group.id, phone.id),
              })),
            )
            .sort((a, b) => a.takenAt - b.takenAt || a.deviceId.localeCompare(b.deviceId))
            .map(({ takenAt: _takenAt, ...phone }) => phone)
        : null;
      return {
        id: group.id,
        name: group.name,
        owner: { userId: group.ownerId, name: group.owner.name },
        isOwner,
        seats: phones && {
          used: phones.length,
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

  const seatsUsed = groups.reduce((total, group) => total + (group.seats?.used ?? 0), 0);
  const seatsOnHold = groups.reduce((total, group) => total + (group.seats?.onHold ?? 0), 0);
  const gauges: Array<{
    id: string;
    label: string;
    used: number;
    max: number;
    onHold: number;
    unit: { one: string; other: string };
  }> = [
    ...(enforced
      ? [
          {
            id: "seats",
            label: "Seats",
            used: seatsUsed,
            max: period.seats,
            onHold: seatsOnHold,
            unit: unit("seat", "seats"),
          },
        ]
      : []),
    {
      id: "groups",
      label: "Groups",
      used: memberships.length,
      max: limits.groupsPerAccount,
      onHold: 0,
      unit: unit("group", "groups"),
    },
  ];

  const usageLimits: Array<{
    id: string;
    label: string;
    value: number;
    unit: { one: string; other: string };
  }> = [
    {
      id: "history",
      label: "Location history kept",
      value: limits.historyDays,
      unit: unit("day", "days"),
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
