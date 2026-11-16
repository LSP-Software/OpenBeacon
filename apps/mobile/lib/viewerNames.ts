export const viewerName = ({
  accountName,
  groupIds,
  groups,
  nicknames,
  userId,
}: {
  accountName: string;
  groupIds: string[];
  groups: { id: string; members: { id: string; userId: string }[] }[];
  nicknames: Record<string, Record<string, { name: string | null }> | undefined>;
  userId: string;
}) => {
  for (const groupId of groupIds) {
    const memberId = groups
      .find((group) => group.id === groupId)
      ?.members.find((member) => member.userId === userId)?.id;
    const nickname = memberId ? nicknames[groupId]?.[memberId]?.name : null;
    if (nickname) {
      return { name: nickname, accountName: nickname === accountName ? null : accountName };
    }
  }
  return { name: accountName, accountName: null };
};
