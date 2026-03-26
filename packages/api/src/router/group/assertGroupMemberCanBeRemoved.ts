import { GroupRole } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";

export const assertGroupMemberCanBeRemoved = async ({
  db,
  groupId,
  memberId,
  role,
}: {
  db: {
    groupMember: {
      count: (args: {
        where: {
          groupId: string;
          id: {
            not: string;
          };
          role: GroupRole;
        };
      }) => Promise<number>;
    };
  };
  groupId: string;
  memberId: string;
  role: GroupRole;
}) => {
  if (role !== GroupRole.OWNER) {
    return;
  }

  const otherOwnerCount = await db.groupMember.count({
    where: {
      groupId,
      id: {
        not: memberId,
      },
      role: GroupRole.OWNER,
    },
  });

  if (otherOwnerCount > 0) {
    return;
  }

  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Cannot remove the only owner from the group.",
  });
};
