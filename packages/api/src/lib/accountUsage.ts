import type { PrismaClient } from "@openbeacon/database";
import { limits, maxAccountSeats } from "./limits.ts";
import { seatsEnforced, type SeatHolds } from "./seats.ts";

type Unit = { one: string; other: string };

export const readAccountUsage = async ({
  allowSelfSetSeats,
  db,
  seatHolds,
  selfHosted,
  userId,
}: {
  allowSelfSetSeats: boolean;
  db: PrismaClient;
  seatHolds: SeatHolds;
  selfHosted: boolean;
  userId: string;
}) => {
  const enforced = seatsEnforced({ selfHosted });
  const [account, memberships, phones, people] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { seats: true } }),
    db.groupMember.findMany({
      where: { userId },
      select: {
        group: {
          select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } },
        },
      },
    }),
    db.userDevice.count({ where: { userId, activatedAt: { not: null }, revokedAt: null } }),
    seatHolds.people(),
  ]);
  const yourPeople = people.filter((person) => person.ownerId === userId);
  const names = await db.user.findMany({
    where: { id: { in: [...new Set(yourPeople.map(({ userId }) => userId))] } },
    select: { id: true, name: true },
  });

  const groups = memberships.map(({ group }) => {
    const isOwner = group.ownerId === userId;
    return {
      id: group.id,
      name: group.name,
      owner: { userId: group.ownerId, name: group.owner.name },
      isOwner,
      people:
        enforced && isOwner
          ? yourPeople
              .filter((person) => person.groupId === group.id)
              .map((person) => ({
                userId: person.userId,
                name: names.find(({ id }) => id === person.userId)?.name ?? "",
                isYou: person.userId === userId,
                onHold: person.held,
              }))
          : null,
      youAreOnHold: people.some(
        (person) => person.groupId === group.id && person.userId === userId && person.held,
      ),
    };
  });
  groups.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));

  const used = new Set(yourPeople.map((person) => person.userId)).size;
  const onHold = new Set(yourPeople.filter(({ held }) => held).map((person) => person.userId)).size;
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
            label: "People",
            used,
            max: account.seats,
            onHold,
            unit: { one: "person", other: "people" },
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
      id: "phones",
      label: "Phones",
      used: phones,
      max: limits.devicesPerAccount,
      onHold: 0,
      unit: { one: "phone", other: "phones" },
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
          seats: account.seats,
          used,
          onHold,
          max: maxAccountSeats,
          selfSetAllowed: allowSelfSetSeats,
        }
      : null,
    groups,
  };
};
