export const resolveSelfDeviceLocationFallback = ({
  getGroupColor,
  groups,
  selfUserId,
  selfUser,
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
  selfUserId: string;
  selfUser?: { image: string | null; name: string } | null;
}) => {
  if (selfUserId.length === 0) {
    return null;
  }

  const memberships = groups.filter((group) =>
    group.members.some((member) => member.userId === selfUserId),
  );
  const primaryGroup = memberships[0];
  if (!primaryGroup) {
    return selfUser
      ? {
          image: selfUser.image,
          name: selfUser.name,
          otherSharedGroupNames: [],
          ringColor: getGroupColor(""),
          sourceGroupId: "",
        }
      : null;
  }

  const selfMember = primaryGroup.members.find((member) => member.userId === selfUserId);
  if (!selfMember) {
    return null;
  }

  const ringColors = [...new Set(memberships.map((group) => getGroupColor(group.id)))];

  return {
    image: selfMember.image,
    name: selfMember.name,
    otherSharedGroupNames: memberships.slice(1).map((group) => group.name),
    ringColor: getGroupColor(primaryGroup.id),
    ...(ringColors.length > 1 ? { ringColors } : {}),
    sourceGroupId: primaryGroup.id,
  };
};
