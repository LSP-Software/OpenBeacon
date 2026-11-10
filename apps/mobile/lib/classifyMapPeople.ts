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
  keyAccess: ReadonlyMap<string, "available" | "failed" | "missing" | "unavailable">;
  markers: readonly LiveMapMarker[];
  now: number;
  selfUserId: string;
  status: MapTrackingStatus;
}): MapPeople => {
  const people: MapPeople = {
    cantLocate: [],
    cantRead: [],
    connectionLost: status.connection === "failing",
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
  const handled = new Set(markers.map((marker) => marker.userId));

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
        isSelf: member.userId === selfUserId,
        name: member.name,
        userId: member.userId,
      };

      if (
        memberGroups.some((item) => loadStatus(item.id) === "loading" || !keyAccess.has(item.id))
      ) {
        people.finding.push(person);
        continue;
      }
      if (
        memberGroups.some(
          (item) =>
            keyAccess.get(item.id) === "failed" ||
            (keyAccess.get(item.id) !== "missing" && loadStatus(item.id) === "failed"),
        )
      ) {
        people.waiting.push(person);
        continue;
      }

      const keyGroup = memberGroups.find((item) => keyAccess.get(item.id) === "missing");
      const pointGroup = memberGroups.find((item) =>
        undecryptable.has(JSON.stringify([item.id, member.userId])),
      );
      const unreadableGroup = keyGroup ?? pointGroup;
      if (unreadableGroup && !person.isSelf) {
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

  const selfFirstThenByName = (
    first: { isSelf: boolean; name: string },
    second: { isSelf: boolean; name: string },
  ) => Number(second.isSelf) - Number(first.isSelf) || first.name.localeCompare(second.name);
  people.upToDate.sort(selfFirstThenByName);
  people.outOfDate.sort(selfFirstThenByName);
  people.cantLocate.sort(selfFirstThenByName);
  people.cantRead.sort(selfFirstThenByName);
  people.finding.sort(selfFirstThenByName);
  people.waiting.sort(selfFirstThenByName);

  return people;
};
