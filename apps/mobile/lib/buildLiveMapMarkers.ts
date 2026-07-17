import type { LiveMapPosition } from "./mapTrackingTypes.ts";

export type LiveMapMarker = {
  battery: {
    charging: boolean;
    level: number;
  };
  image: string | null;
  initials: string;
  isSelf: boolean;
  latitude: number;
  longitude: number;
  name: string;
  otherSharedGroupNames: string[];
  ringColor: string;
  sourceGroupId: string;
  timestamp: string;
  userId: string;
};

export const buildLiveMapMarkers = ({
  getGroupColor,
  groups,
  positions,
  selfUserId,
}: {
  getGroupColor: (groupId: string) => string;
  groups: readonly {
    id: string;
    name: string;
    members: readonly {
      id: string;
      image: string | null;
      name: string;
    }[];
  }[];
  positions: readonly LiveMapPosition[];
  selfUserId: string;
}): LiveMapMarker[] => {
  const memberById = new Map<string, { image: string | null; name: string }>();
  for (const group of groups) {
    for (const member of group.members) {
      if (!memberById.has(member.id)) {
        memberById.set(member.id, { image: member.image, name: member.name });
      }
    }
  }

  return positions.map((livePosition) => {
    const member = memberById.get(livePosition.userId);
    const name = member?.name ?? "Unknown";

    return {
      battery: livePosition.battery,
      image: member?.image ?? null,
      initials: initialsFromName(name),
      isSelf: livePosition.userId === selfUserId,
      latitude: livePosition.latitude,
      longitude: livePosition.longitude,
      name,
      otherSharedGroupNames: otherSharedGroupNames({
        groups,
        sourceGroupId: livePosition.sourceGroupId,
        userId: livePosition.userId,
      }),
      ringColor: getGroupColor(livePosition.sourceGroupId),
      sourceGroupId: livePosition.sourceGroupId,
      timestamp: livePosition.timestamp,
      userId: livePosition.userId,
    };
  });
};

const initialsFromName = (name: string) => {
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
    members: readonly { id: string }[];
  }[];
  sourceGroupId: string;
  userId: string;
}) => {
  return groups
    .filter(
      (group) => group.id !== sourceGroupId && group.members.some((member) => member.id === userId),
    )
    .map((group) => group.name);
};
