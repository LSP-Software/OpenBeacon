import { initialsFromName, type LiveMapMarker } from "./buildLiveMapMarkers.ts";
import type { MapGroup, MapHiddenPerson } from "./mapPeopleTypes.ts";

export const canHideMapGroups = (groupCount: number) => groupCount > 1;

export const resolveHiddenGroupIds = (
  groups: readonly { id: string }[],
  storedHiddenGroupIds: readonly string[],
): ReadonlySet<string> =>
  canHideMapGroups(groups.length)
    ? new Set(storedHiddenGroupIds.filter((id) => groups.some((group) => group.id === id)))
    : new Set();

export const shownMapGroups = ({
  groups,
  hiddenGroupIds,
  selfUserId,
}: {
  groups: readonly MapGroup[];
  hiddenGroupIds: ReadonlySet<string>;
  selfUserId: string;
}): readonly MapGroup[] => {
  const shown = groups.filter((group) => !hiddenGroupIds.has(group.id));
  if (shown.length > 0) return shown;
  return groups.map((group) => ({
    ...group,
    members: group.members.filter((member) => member.userId === selfUserId),
  }));
};

export const hideMapGroupMarkers = ({
  getGroupColor,
  groups,
  hiddenGroupIds,
  markers,
  selfUserId,
}: {
  getGroupColor: (groupId: string) => string;
  groups: readonly MapGroup[];
  hiddenGroupIds: ReadonlySet<string>;
  markers: readonly LiveMapMarker[];
  selfUserId: string;
}): readonly LiveMapMarker[] => {
  if (hiddenGroupIds.size === 0) return markers;

  return markers.flatMap((marker) => {
    const memberGroups = groupsOf(groups, marker.userId);
    if (!memberGroups.some((group) => hiddenGroupIds.has(group.id))) return [marker];
    const shownGroups = memberGroups.filter((group) => !hiddenGroupIds.has(group.id));
    const colors = [...new Set(shownGroups.map((group) => getGroupColor(group.id)))];
    const [firstColor] = colors;
    if (firstColor === undefined) return marker.userId === selfUserId ? [marker] : [];

    const shownNames = new Set(shownGroups.map((group) => group.name));
    const hiddenNames = new Set(
      memberGroups
        .filter((group) => hiddenGroupIds.has(group.id) && !shownNames.has(group.name))
        .map((group) => group.name),
    );
    const { ringColors: _ringColors, ...rest } = marker;
    return [
      {
        ...rest,
        otherSharedGroupNames: marker.otherSharedGroupNames.filter(
          (name) => !hiddenNames.has(name),
        ),
        ringColor: shownGroups.some((group) => group.id === marker.sourceGroupId)
          ? getGroupColor(marker.sourceGroupId)
          : firstColor,
        ...(colors.length > 1 ? { ringColors: colors } : {}),
      },
    ];
  });
};

export const listHiddenMapPeople = ({
  groups,
  hiddenGroupIds,
  selfUserId,
}: {
  groups: readonly MapGroup[];
  hiddenGroupIds: ReadonlySet<string>;
  selfUserId: string;
}): MapHiddenPerson[] => {
  const hidden = new Map<string, MapHiddenPerson>();
  for (const group of groups) {
    if (!hiddenGroupIds.has(group.id)) continue;
    for (const member of group.members) {
      if (member.userId === selfUserId || hidden.has(member.userId)) continue;
      const memberGroups = groupsOf(groups, member.userId);
      if (memberGroups.some((item) => !hiddenGroupIds.has(item.id))) continue;
      hidden.set(member.userId, {
        groupNames: memberGroups.map((item) => item.name),
        hiddenGroups: memberGroups.map((item) => ({ id: item.id, name: item.name })),
        image: member.image,
        initials: initialsFromName(member.name),
        isSelf: false,
        name: member.name,
        userId: member.userId,
      });
    }
  }
  return [...hidden.values()].sort((first, second) => first.name.localeCompare(second.name));
};

const groupsOf = (groups: readonly MapGroup[], userId: string) =>
  groups.filter((group) => group.members.some((member) => member.userId === userId));
