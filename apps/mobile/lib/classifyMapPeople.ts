import { initialsFromName, type LiveMapMarker } from "./buildLiveMapMarkers.ts";
import { locationStaleAt } from "./locationStaleAt.ts";
import type { MapGroup, MapPeople } from "./mapPeopleTypes.ts";
import type { MapTrackingStatus } from "./mapTrackingTypes.ts";
import { canShowSharedLocation } from "./locationSharingVisibility.ts";

export const classifyMapPeople = ({
  groups,
  keyAccess,
  markers,
  now,
  selfUserId,
  status,
}: {
  groups: readonly MapGroup[];
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
    hidden: [],
    outOfDate: [],
    paused: [],
    upToDate: [],
    waiting: [],
  };

  const bestByUserId = new Map<string, { isOutOfDate: boolean; marker: LiveMapMarker }>();
  for (const marker of markers) {
    if (!canShowSharedLocation(marker, status.sharing)) continue;
    const isOutOfDate = marker.timestamp !== null && now >= locationStaleAt(marker.timestamp);
    const best = bestByUserId.get(marker.userId);
    const comparison = best
      ? Number(best.isOutOfDate) - Number(isOutOfDate) ||
        Number(marker.isSelf) - Number(best.marker.isSelf) ||
        (marker.timestamp ?? "").localeCompare(best.marker.timestamp ?? "")
      : 1;
    if (comparison > 0) bestByUserId.set(marker.userId, { isOutOfDate, marker });
  }
  for (const { isOutOfDate, marker } of bestByUserId.values()) {
    const person =
      marker.userId === selfUserId && !marker.isSelf ? { ...marker, isSelf: true } : marker;
    (isOutOfDate ? people.outOfDate : people.upToDate).push(person);
  }

  const undecryptable = new Set(
    status.undecryptable.map(({ groupId, userId }) => JSON.stringify([groupId, userId])),
  );
  const loadStatus = (groupId: string) =>
    status.groups[groupId] ?? (status.membership === "failed" ? "failed" : "loading");
  const handled = new Set(bestByUserId.keys());

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
      const devices = status.sharing?.filter((device) => device.userId === member.userId) ?? [];
      if (devices.length > 0 && devices.every((device) => device.paused)) {
        people.paused.push({ ...person, sharingPaused: true });
        continue;
      }

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
  people.paused.sort(selfFirstThenByName);

  return people;
};

export const flagUnreadableMarkers = ({
  groups,
  markers,
  status,
}: {
  groups: readonly { id: string; name: string; members: readonly { userId: string }[] }[];
  markers: readonly LiveMapMarker[];
  status: MapTrackingStatus;
}): LiveMapMarker[] =>
  markers.map((marker) => {
    if (marker.isSelf) return marker;
    const group = groups.find(
      (item) =>
        item.members.some((member) => member.userId === marker.userId) &&
        status.undecryptable.some(
          ({ deviceId, groupId, userId }) =>
            groupId === item.id && userId === marker.userId && deviceId === marker.deviceId,
        ),
    );
    if (!group) return marker;
    return { ...marker, unreadableGroup: { id: group.id, name: group.name } };
  });
