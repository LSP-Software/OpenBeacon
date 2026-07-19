export const resolveSelfDeviceLocationFallback = ({
  getGroupColor,
  groups,
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
  selfUserId: string;
}) => {
  if (selfUserId.length === 0 || groups.length === 0) {
    return null;
  }

  const memberships = groups.filter((group) =>
    group.members.some((member) => member.userId === selfUserId),
  );
  const primaryGroup = memberships[0];
  if (!primaryGroup) {
    return null;
  }

  const selfMember = primaryGroup.members.find((member) => member.userId === selfUserId);
  if (!selfMember) {
    return null;
  }

  return {
    image: selfMember.image,
    name: selfMember.name,
    otherSharedGroupNames: memberships.slice(1).map((group) => group.name),
    ringColor: getGroupColor(primaryGroup.id),
    sourceGroupId: primaryGroup.id,
  };
};
