import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";

const MERGE_DISTANCE = 54;
const STAY_MERGED_DISTANCE = 64;
const WORLD_SIZE_AT_ZOOM_ZERO = 512;
const SPLIT_SEARCH_STEP = 0.25;
const SPLIT_ZOOM_MARGIN = 0.5;
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

const pixelsPerWorld = (zoom: number) => WORLD_SIZE_AT_ZOOM_ZERO * 2 ** zoom;

const groupId = (members: readonly LiveMapMarker[]) => {
  const userIds = members.map((member) => member.userId).sort();
  return userIds.length === 1 ? (userIds[0] ?? "") : `stack:${userIds[0]}`;
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
  const previousGroupIdByUserId = new Map(
    previous.flatMap((group) => group.members.map((member) => [member.userId, group.id] as const)),
  );
  const scale = pixelsPerWorld(zoom);
  const clusters = markers.map((marker) => {
    const previousGroupId = previousGroupIdByUserId.get(marker.userId);
    return {
      members: [marker],
      previousGroupIds: new Set(previousGroupId === undefined ? [] : [previousGroupId]),
      world: worldPoint(marker.latitude, marker.longitude),
    };
  });

  while (clusters.length > 1) {
    let closest: { first: number; second: number; distance: number } | null = null;
    for (let first = 0; first < clusters.length; first += 1) {
      for (let second = first + 1; second < clusters.length; second += 1) {
        const a = clusters[first]!;
        const b = clusters[second]!;
        const distance = Math.hypot(a.world.x - b.world.x, a.world.y - b.world.y) * scale;
        const wasTogether = [...a.previousGroupIds].some(
          (id) => id.startsWith("stack:") && b.previousGroupIds.has(id),
        );
        if (
          distance < (wasTogether ? STAY_MERGED_DISTANCE : MERGE_DISTANCE) &&
          (!closest || distance < closest.distance)
        ) {
          closest = { first, second, distance };
        }
      }
    }
    if (!closest) break;

    const a = clusters[closest.first]!;
    const b = clusters[closest.second]!;
    const total = a.members.length + b.members.length;
    a.world = {
      x: (a.world.x * a.members.length + b.world.x * b.members.length) / total,
      y: (a.world.y * a.members.length + b.world.y * b.members.length) / total,
    };
    a.members = [...a.members, ...b.members];
    a.previousGroupIds = new Set([...a.previousGroupIds, ...b.previousGroupIds]);
    clusters.splice(closest.second, 1);
  }

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
          .map((member) => member.userId)
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
      return Math.min(MAX_SPLIT_ZOOM, candidate + SPLIT_ZOOM_MARGIN);
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
  const groupByUserId = (groups: readonly LiveMapPinGroup[]) =>
    new Map(groups.flatMap((group) => group.members.map((m) => [m.userId, group] as const)));
  const previousByUserId = groupByUserId(previous);
  const previousById = new Map(previous.map((group) => [group.id, group]));
  const arrivals = new Map<string, LiveMapPinOffset>();
  const gathering: Array<{ gatherTo: LiveMapPinOffset; marker: LiveMapMarker }> = [];

  for (const group of next) {
    const isStack = group.members.length > 1;
    const before = previousById.get(group.id);
    if (isStack && !before) {
      const parentStack = group.members
        .map((member) => previousByUserId.get(member.userId))
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
      const memberBefore = previousByUserId.get(member.userId);
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
