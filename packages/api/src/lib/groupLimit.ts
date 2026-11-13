import type { Prisma } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";
import { ReasonError } from "./reasonError.ts";

export const maxGroupsPerAccount = 16;

export const assertAccountBelowGroupLimit = async (
  tx: Prisma.TransactionClient,
  userId: string,
) => {
  const groups = await tx.groupMember.count({ where: { userId } });
  if (groups < maxGroupsPerAccount) return;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `An account can be in at most ${maxGroupsPerAccount} groups. Leave a group before creating or joining another.`,
    cause: new ReasonError("GROUP_LIMIT_REACHED"),
  });
};
