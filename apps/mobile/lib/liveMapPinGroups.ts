import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";
import { mergeClosestPairs } from "./mergeClosestPairs.ts";

const SAME_PERSON_MERGE_METERS = 50;
const SPLIT_SEARCH_STEP = 0.25;
const MAX_SPLIT_ZOOM = 17;

export type LiveMapPinGroup = {
  id: string;
  latitude: number;
  longitude: number;
  members: LiveMapMarker[];
};

export type LiveMapPinOffset = { x: number; y: number; pop?: boolean };

const worldPoint = (latitude: number, longitude: number) => {
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = (clampedLatitude * Math.PI) / 180;
  return {
    x: (longitude + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI),
  };
};

const pixelsPerWorld = (zoom: number) => 512 * 2 ** zoom;

const groupId = (members: readonly LiveMapMarker[]) => {
  const deviceIds = members.map((member) => member.deviceId).sort();
  return deviceIds.length === 1 ? (deviceIds[0] ?? "") : `stack:${deviceIds[0]}`;
};

const metersBetween = (
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
) => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(first.latitude)) *
      Math.cos(toRadians(second.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
};

export const mergeSamePersonDevices = (markers: readonly LiveMapMarker[]): LiveMapMarker[] => {
  const preferred = [...markers].sort(
    (first, second) =>
      Number(second.isSelf) - Number(first.isSelf) ||
      (second.timestamp ?? "").localeCompare(first.timestamp ?? ""),
  );
  const merged: Array<{ deviceIds: string[]; marker: LiveMapMarker }> = [];
  for (const marker of preferred) {
    const pin = merged.find(
      (item) =>
        item.marker.userId === marker.userId &&
        metersBetween(item.marker, marker) <= SAME_PERSON_MERGE_METERS,
    );
    if (pin) {
      pin.deviceIds.push(marker.deviceId);
    } else {
      merged.push({ deviceIds: [marker.deviceId], marker });
    }
  }
  const deviceIdsByPin = new Map(merged.map((item) => [item.marker.deviceId, item.deviceIds]));
  return markers.flatMap((marker) => {
    const deviceIds = deviceIdsByPin.get(marker.deviceId);
    if (deviceIds === undefined) return [];
    return [deviceIds.length > 1 ? { ...marker, mergedDeviceIds: deviceIds } : marker];
  });
};

export const groupLiveMapPins = ({
  markers,
  previous = [],
  zoom,
}: {
  markers: readonly LiveMapMarker[];
  previous?: readonly LiveMapPinGroup[];
  zoom: number;
}): LiveMapPinGroup[] => {
  const previousGroupIdByDeviceId = new Map(
    previous.flatMap((group) =>
      group.members.map((member) => [member.deviceId, group.id] as const),
    ),
  );
  const scale = pixelsPerWorld(zoom);
  const clusters = mergeClosestPairs({
    clusters: markers.map((marker) => {
      const previousGroupId = previousGroupIdByDeviceId.get(marker.deviceId);
      return {
        members: [marker],
        previousGroupIds: new Set(previousGroupId === undefined ? [] : [previousGroupId]),
        world: worldPoint(marker.latitude, marker.longitude),
      };
    }),
    distanceBetween: (a, b) => Math.hypot(a.world.x - b.world.x, a.world.y - b.world.y) * scale,
    mergeDistanceFor: (a, b) =>
      [...a.previousGroupIds].some((id) => id.startsWith("stack:") && b.previousGroupIds.has(id))
        ? 64
        : 54,
    merge: (a, b) => {
      const total = a.members.length + b.members.length;
      return {
        members: [...a.members, ...b.members],
        previousGroupIds: new Set([...a.previousGroupIds, ...b.previousGroupIds]),
        world: {
          x: (a.world.x * a.members.length + b.world.x * b.members.length) / total,
          y: (a.world.y * a.members.length + b.world.y * b.members.length) / total,
        },
      };
    },
  });

  return clusters.map(({ members }) => ({
    id: groupId(members),
    latitude: members.reduce((sum, member) => sum + member.latitude, 0) / members.length,
    longitude: members.reduce((sum, member) => sum + member.longitude, 0) / members.length,
    members,
  }));
};

export const hasSameLiveMapPinGroups = (
  first: readonly LiveMapPinGroup[],
  second: readonly LiveMapPinGroup[],
) => {
  const membership = (groups: readonly LiveMapPinGroup[]) =>
    groups
      .map((group) =>
        group.members
          .map((member) => member.deviceId)
          .sort()
          .join(","),
      )
      .sort()
      .join("|");
  return membership(first) === membership(second);
};

export const liveMapStackExpansionZoom = ({
  group,
  zoom,
}: {
  group: LiveMapPinGroup;
  zoom: number;
}) => {
  for (
    let candidate = zoom + SPLIT_SEARCH_STEP;
    candidate <= MAX_SPLIT_ZOOM;
    candidate += SPLIT_SEARCH_STEP
  ) {
    if (
      groupLiveMapPins({ markers: group.members, zoom: candidate, previous: [group] }).length > 1
    ) {
      return Math.min(MAX_SPLIT_ZOOM, candidate + 0.5);
    }
  }
  return null;
};

const screenOffset = (
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  zoom: number,
) => {
  const start = worldPoint(from.latitude, from.longitude);
  const end = worldPoint(to.latitude, to.longitude);
  const scale = pixelsPerWorld(zoom);
  return { x: (end.x - start.x) * scale, y: (end.y - start.y) * scale };
};

export const liveMapPinTransition = ({
  next,
  previous,
  zoom,
}: {
  next: readonly LiveMapPinGroup[];
  previous: readonly LiveMapPinGroup[];
  zoom: number;
}) => {
  const groupByDeviceId = (groups: readonly LiveMapPinGroup[]) =>
    new Map(groups.flatMap((group) => group.members.map((m) => [m.deviceId, group] as const)));
  const previousByDeviceId = groupByDeviceId(previous);
  const previousById = new Map(previous.map((group) => [group.id, group]));
  const arrivals = new Map<string, LiveMapPinOffset>();
  const gathering: Array<{ gatherTo: LiveMapPinOffset; marker: LiveMapMarker }> = [];

  for (const group of next) {
    const isStack = group.members.length > 1;
    const before = previousById.get(group.id);
    if (isStack && !before) {
      const parentStack = group.members
        .map((member) => previousByDeviceId.get(member.deviceId))
        .find((candidate) => candidate !== undefined && candidate.members.length > 1);
      arrivals.set(
        group.id,
        parentStack ? screenOffset(group, parentStack, zoom) : { x: 0, y: 0, pop: true },
      );
    } else if (isStack && before) {
      const moved = screenOffset(group, before, zoom);
      if (Math.hypot(moved.x, moved.y) >= 1) arrivals.set(group.id, moved);
    }

    for (const member of group.members) {
      const memberBefore = previousByDeviceId.get(member.deviceId);
      if (!memberBefore) continue;
      if (isStack && memberBefore.members.length === 1) {
        gathering.push({ marker: member, gatherTo: screenOffset(member, group, zoom) });
      } else if (!isStack && memberBefore.members.length > 1) {
        arrivals.set(group.id, screenOffset(member, memberBefore, zoom));
      }
    }
  }

  return { arrivals, gathering };
};
