import { initialsFromName, type LiveMapMarker } from "./buildLiveMapMarkers.ts";
import { locationStaleAt } from "./locationStaleAt.ts";
import type { MapPeople } from "./mapPeopleTypes.ts";
import type { MapTrackingStatus } from "./mapTrackingTypes.ts";

export const classifyMapPeople = ({
  groups,
  keyAccess,
  markers,
  now,
  selfUserId,
  status,
}: {
  groups: readonly {
    id: string;
    name: string;
    members: readonly { image: string | null; name: string; userId: string }[];
  }[];
  keyAccess: ReadonlyMap<string, "available" | "missing" | "unavailable">;
  markers: readonly LiveMapMarker[];
  now: number;
  selfUserId: string;
  status: MapTrackingStatus;
}): MapPeople => {
  const people: MapPeople = {
    cantLocate: [],
    cantRead: [],
    finding: [],
    outOfDate: [],
    upToDate: [],
    waiting: [],
  };

  for (const marker of markers) {
    const isOutOfDate = marker.timestamp !== null && now >= locationStaleAt(marker.timestamp);
    (isOutOfDate ? people.outOfDate : people.upToDate).push(marker);
  }

  const undecryptable = new Set(
    status.undecryptable.map(({ groupId, userId }) => JSON.stringify([groupId, userId])),
  );
  const loadStatus = (groupId: string) =>
    status.groups[groupId] ?? (status.membership === "failed" ? "failed" : "loading");
  const handled = new Set([selfUserId, ...markers.map((marker) => marker.userId)]);

  for (const group of groups) {
    for (const member of group.members) {
      if (handled.has(member.userId)) continue;
      handled.add(member.userId);

      const memberGroups = groups.filter((item) =>
        item.members.some((other) => other.userId === member.userId),
      );
      const person = {
        groupNames: memberGroups.map((item) => item.name),
        image: member.image,
        initials: initialsFromName(member.name),
        name: member.name,
        userId: member.userId,
      };

      if (
        memberGroups.some((item) => loadStatus(item.id) === "loading" || !keyAccess.has(item.id))
      ) {
        people.finding.push(person);
        continue;
      }
      if (memberGroups.some((item) => loadStatus(item.id) === "failed")) {
        people.waiting.push(person);
        continue;
      }

      const keyGroup = memberGroups.find((item) => keyAccess.get(item.id) === "missing");
      const pointGroup = memberGroups.find((item) =>
        undecryptable.has(JSON.stringify([item.id, member.userId])),
      );
      const unreadableGroup = keyGroup ?? pointGroup;
      if (unreadableGroup) {
        people.cantRead.push({
          ...person,
          groupId: unreadableGroup.id,
          groupName: unreadableGroup.name,
          reason: keyGroup ? "groupKey" : "point",
        });
        continue;
      }

      people.cantLocate.push(person);
    }
  }

  const byName = (first: { name: string }, second: { name: string }) =>
    first.name.localeCompare(second.name);
  people.upToDate.sort(
    (first, second) => Number(second.isSelf) - Number(first.isSelf) || byName(first, second),
  );
  people.outOfDate.sort(
    (first, second) => Number(second.isSelf) - Number(first.isSelf) || byName(first, second),
  );
  people.cantLocate.sort(byName);
  people.cantRead.sort(byName);
  people.finding.sort(byName);
  people.waiting.sort(byName);

  return people;
};
