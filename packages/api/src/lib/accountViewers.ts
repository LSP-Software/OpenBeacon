import { GroupEventType, type PrismaClient } from "@openbeacon/database";
import { HISTORY_RETENTION_MS } from "./placeTransitions.ts";

const startTypes: GroupEventType[] = [GroupEventType.GROUP_CREATED, GroupEventType.MEMBER_JOINED];
const endTypes: GroupEventType[] = [
  GroupEventType.MEMBER_LEFT,
  GroupEventType.MEMBER_REMOVED,
  GroupEventType.ACCOUNT_DELETED,
];

export const pastViewers = ({
  currentMembers,
  events,
  userId,
}: {
  currentMembers: { groupId: string; userId: string; since: Date }[];
  events: MembershipEvent[];
  userId: string;
}) => {
  const groups = new Map<string, Map<string, Span[]>>();
  const spansFor = (groupId: string, memberUserId: string) => {
    const members = groups.get(groupId) ?? new Map<string, Span[]>();
    groups.set(groupId, members);
    const spans = members.get(memberUserId) ?? [];
    members.set(memberUserId, spans);
    return spans;
  };
  const sorted = [...events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1),
  );
  for (const event of sorted) {
    if (!event.memberUserId) continue;
    const spans = spansFor(event.groupId, event.memberUserId);
    const open = spans.at(-1)?.to === undefined ? spans.at(-1) : undefined;
    if (startTypes.includes(event.type)) {
      if (!open) spans.push({ from: event.createdAt, to: undefined, ended: null });
    } else if (open) {
      open.to = event.createdAt;
      open.ended = event.type;
    } else {
      spans.push({ from: null, to: event.createdAt, ended: event.type });
    }
  }
  for (const members of groups.values()) {
    for (const spans of members.values()) {
      if (spans.at(-1)?.to === undefined) spans.pop();
    }
  }
  for (const member of currentMembers) {
    spansFor(member.groupId, member.userId).push({
      from: member.since,
      to: undefined,
      ended: null,
    });
  }

  const viewers: {
    groupId: string;
    userId: string;
    from: Date | null;
    to: Date;
    reason: "theyLeft" | "theyWereRemoved" | "youLeft" | "youWereRemoved";
  }[] = [];
  for (const [groupId, members] of groups) {
    const mine = members.get(userId) ?? [];
    for (const [otherUserId, theirs] of members) {
      if (otherUserId === userId) continue;
      for (const my of mine) {
        for (const their of theirs) {
          const from = latest(my.from, their.from);
          const to = earliest(my.to, their.to);
          if (to === undefined) continue;
          if (my.from && their.to && my.from.getTime() >= their.to.getTime()) continue;
          if (their.from && my.to && their.from.getTime() >= my.to.getTime()) continue;
          const youEnded = my.to?.getTime() === to.getTime();
          const removed = (youEnded ? my.ended : their.ended) === GroupEventType.MEMBER_REMOVED;
          viewers.push({
            groupId,
            userId: otherUserId,
            from,
            to,
            reason: youEnded
              ? removed
                ? "youWereRemoved"
                : "youLeft"
              : removed
                ? "theyWereRemoved"
                : "theyLeft",
          });
        }
      }
    }
  }
  return viewers.sort((a, b) => b.to.getTime() - a.to.getTime());
};

export const readAccountViewers = async ({
  db,
  now,
  userId,
}: {
  db: PrismaClient;
  now: Date;
  userId: string;
}) => {
  const since = new Date(now.getTime() - HISTORY_RETENTION_MS);
  const [memberships, ownEvents] = await Promise.all([
    db.groupMember.findMany({ where: { userId }, select: { groupId: true } }),
    db.groupEvent.findMany({
      where: {
        createdAt: { gte: since },
        OR: [
          { subjectUserId: userId, type: { in: [...startTypes, ...endTypes] } },
          { actorUserId: userId, type: GroupEventType.GROUP_CREATED },
        ],
      },
      select: { groupId: true },
      distinct: ["groupId"],
    }),
  ]);
  const groupIds = [...new Set([...memberships, ...ownEvents].map(({ groupId }) => groupId))];
  const [groups, events] = await Promise.all([
    db.group.findMany({
      where: { id: { in: groupIds } },
      select: {
        id: true,
        name: true,
        groupMembers: {
          select: { createdAt: true, user: { select: { id: true, name: true, image: true } } },
        },
      },
    }),
    db.groupEvent.findMany({
      where: {
        groupId: { in: groupIds },
        createdAt: { gte: since },
        type: { in: [...startTypes, ...endTypes] },
      },
      select: {
        id: true,
        groupId: true,
        type: true,
        actorUserId: true,
        subjectUserId: true,
        createdAt: true,
      },
    }),
  ]);
  const current = new Map<
    string,
    {
      userId: string;
      name: string;
      image: string | null;
      groups: { id: string; name: string; since: Date }[];
    }
  >();
  for (const group of groups) {
    const joinedAt = group.groupMembers.find((member) => member.user.id === userId)?.createdAt;
    if (!joinedAt) continue;
    for (const member of group.groupMembers) {
      if (member.user.id === userId) continue;
      const viewer = current.get(member.user.id) ?? {
        userId: member.user.id,
        name: member.user.name,
        image: member.user.image,
        groups: [],
      };
      viewer.groups.push({
        id: group.id,
        name: group.name,
        since: member.createdAt > joinedAt ? member.createdAt : joinedAt,
      });
      current.set(member.user.id, viewer);
    }
  }

  const past = pastViewers({
    userId,
    currentMembers: groups.flatMap((group) =>
      group.groupMembers.map((member) => ({
        groupId: group.id,
        userId: member.user.id,
        since: member.createdAt,
      })),
    ),
    events: events.map((event) => ({
      id: event.id,
      groupId: event.groupId,
      type: event.type,
      createdAt: event.createdAt,
      memberUserId:
        event.type === GroupEventType.GROUP_CREATED ? event.actorUserId : event.subjectUserId,
    })),
  });
  const pastUserIds = [...new Set(past.map((viewer) => viewer.userId))];
  const people = await db.user.findMany({
    where: { id: { in: pastUserIds } },
    select: { id: true, name: true, image: true },
  });
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const peopleById = new Map(people.map((person) => [person.id, person]));

  return {
    since,
    current: [...current.values()].sort((a, b) => a.name.localeCompare(b.name)),
    past: past.flatMap((viewer) => {
      const person = peopleById.get(viewer.userId);
      const groupName = groupNames.get(viewer.groupId);
      if (!person || groupName === undefined) return [];
      return [
        {
          ...viewer,
          name: person.name,
          image: person.image,
          groupName,
        },
      ];
    }),
  };
};

const latest = (a: Date | null, b: Date | null) =>
  a === null || b === null ? null : a.getTime() > b.getTime() ? a : b;

const earliest = (a: Date | undefined, b: Date | undefined) =>
  a === undefined ? b : b === undefined ? a : a.getTime() < b.getTime() ? a : b;

type MembershipEvent = {
  id: string;
  groupId: string;
  type: GroupEventType;
  createdAt: Date;
  memberUserId: string | null;
};

type Span = { from: Date | null; to: Date | undefined; ended: GroupEventType | null };
