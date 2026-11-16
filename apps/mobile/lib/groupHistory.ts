import type { RouterOutputs } from "./api.ts";
import { storage } from "./storage.ts";

export type GroupHistoryItem = RouterOutputs["groupHistory"]["list"]["items"][number];

export const groupByDay = <T extends { at: Date }>({
  items,
  now,
}: {
  items: readonly T[];
  now: Date;
}) => {
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const sections: { key: string; title: string; items: T[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.at);
    const section = sections.at(-1);
    if (section?.key === key) {
      section.items.push(item);
      continue;
    }
    sections.push({
      key,
      title:
        key === today
          ? "Today"
          : key === yesterday
            ? "Yesterday"
            : item.at.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              }),
      items: [item],
    });
  }
  return sections;
};

export const describeGroupEvent = ({
  event,
  memberName,
  userId,
}: {
  event: Extract<GroupHistoryItem, { kind: "group" }>;
  memberName: (memberUserId: string) => string | null;
  userId: string | undefined;
}) => {
  const person = (who: { userId: string; name: string } | null, startOfSentence: boolean) => {
    if (!who) return startOfSentence ? "A deleted account" : "a deleted account";
    if (who.userId === userId) return startOfSentence ? "You" : "you";
    return memberName(who.userId) ?? who.name;
  };
  const actor = person(event.actor, true);
  const subject = person(event.subject, false);
  const place = `${event.emoji ?? ""} ${event.name ?? ""}`.trim();
  const role =
    event.role === "OWNER" ? "an owner" : event.role === "ADMIN" ? "an admin" : "a member";
  switch (event.type) {
    case "GROUP_CREATED":
      return `${actor} created the group`;
    case "MEMBER_JOINED":
      return `${person(event.subject, true)} joined${event.role === "MEMBER" || !event.role ? "" : ` as ${role}`}`;
    case "MEMBER_LEFT":
      return `${person(event.subject, true)} left the group`;
    case "MEMBER_REMOVED":
      return `${actor} removed ${subject}`;
    case "ACCOUNT_DELETED":
      return "A member deleted their account";
    case "ROLE_CHANGED":
      if (event.actor && event.actor.userId === event.subject?.userId) {
        return `${actor} became ${role}`;
      }
      return event.role === "MEMBER"
        ? `${actor} changed ${subject === "you" ? "your" : `${subject}’s`} role to member`
        : `${actor} made ${subject} ${role}`;
    case "GROUP_RENAMED":
      if (!event.name) return `${actor} renamed the group`;
      return event.previousName
        ? `${actor} renamed the group from “${event.previousName}” to “${event.name}”`
        : `${actor} renamed the group to “${event.name}”`;
    case "GROUP_IMAGE_CHANGED":
      return `${actor} changed the group picture`;
    case "PLACE_ADDED":
      return `${actor} added ${place}`;
    case "PLACE_UPDATED":
      return event.previousName && event.name
        ? `${actor} renamed “${event.previousName}” to “${event.name}”`
        : `${actor} edited ${place}`;
    case "PLACE_DELETED":
      return `${actor} deleted ${place}`;
  }
};

const seenKey = (userId: string, groupId: string) => `groupHistory.seenAt.${userId}.${groupId}`;

export const hasUnseenGroupHistory = ({
  groupId,
  latestAt,
  userId,
}: {
  groupId: string;
  latestAt: Date | null;
  userId: string;
}) => {
  if (!latestAt) return false;
  const seenAt = storage.getNumber(seenKey(userId, groupId));
  return seenAt === undefined || latestAt.getTime() > seenAt;
};

export const markGroupHistorySeen = ({
  groupId,
  latestAt,
  userId,
}: {
  groupId: string;
  latestAt: Date | null;
  userId: string;
}) => {
  if (!latestAt || !hasUnseenGroupHistory({ groupId, latestAt, userId })) return;
  storage.set(seenKey(userId, groupId), latestAt.getTime());
};
