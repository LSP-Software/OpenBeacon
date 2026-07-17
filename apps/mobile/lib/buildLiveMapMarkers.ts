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
      image: string | null;
      name: string;
      userId: string;
    }[];
  }[];
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

  return positions.map((livePosition) => {
    const member = memberByUserId.get(livePosition.userId);
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
