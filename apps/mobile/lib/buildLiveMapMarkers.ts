import type { MapGroup } from "./mapPeopleTypes.ts";
import type { LiveMapPosition } from "./mapTrackingTypes.ts";

export type LiveMapMarker = {
  battery: {
    charging: boolean;
    level: number;
  } | null;
  image: string | null;
  initials: string;
  isSelf: boolean;
  latitude: number;
  longitude: number;
  name: string;
  otherSharedGroupNames: string[];
  ringColor: string;
  ringColors?: string[];
  sourceGroupId: string;
  timestamp: string | null;
  unreadableGroup?: { id: string; name: string };
  userId: string;
};

export const buildLiveMapMarkers = ({
  getGroupColor,
  groups,
  positions,
  selfUserId,
}: {
  getGroupColor: (groupId: string) => string;
  groups: readonly MapGroup[];
  positions: readonly LiveMapPosition[];
  selfUserId: string;
}): LiveMapMarker[] => {
  const memberByUserId = new Map<string, { image: string | null; name: string }>();
  for (const group of groups) {
    for (const member of group.members) {
      if (!memberByUserId.has(member.userId)) {
        memberByUserId.set(member.userId, { image: member.image, name: member.name });
      }
    }
  }

  const markers: LiveMapMarker[] = [];
  for (const livePosition of positions) {
    const member =
      groups
        .find((group) => group.id === livePosition.sourceGroupId)
        ?.members.find((item) => item.userId === livePosition.userId) ??
      memberByUserId.get(livePosition.userId);
    if (!member) {
      continue;
    }

    const ringColors = [
      ...new Set(
        groups
          .filter((group) => group.members.some((member) => member.userId === livePosition.userId))
          .map((group) => getGroupColor(group.id)),
      ),
    ];

    markers.push({
      battery: livePosition.battery,
      image: member.image,
      initials: initialsFromName(member.name),
      isSelf: livePosition.userId === selfUserId,
      latitude: livePosition.latitude,
      longitude: livePosition.longitude,
      name: member.name,
      otherSharedGroupNames: otherSharedGroupNames({
        groups,
        sourceGroupId: livePosition.sourceGroupId,
        userId: livePosition.userId,
      }),
      ringColor:
        ringColors.length === 1 ? ringColors[0]! : getGroupColor(livePosition.sourceGroupId),
      ...(ringColors.length > 1 ? { ringColors } : {}),
      sourceGroupId: livePosition.sourceGroupId,
      timestamp: livePosition.timestamp,
      userId: livePosition.userId,
    });
  }

  return markers;
};

export const initialsFromName = (name: string) => {
  const initials = name.charAt(0) + name.charAt(1);
  return initials.length === 2 ? initials : "??";
};

const otherSharedGroupNames = ({
  groups,
  sourceGroupId,
  userId,
}: {
  groups: readonly {
    id: string;
    name: string;
    members: readonly { userId: string }[];
  }[];
  sourceGroupId: string;
  userId: string;
}) => {
  return groups
    .filter(
      (group) =>
        group.id !== sourceGroupId && group.members.some((member) => member.userId === userId),
    )
    .map((group) => group.name);
};
