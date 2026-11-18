import type { Prisma } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";
import { limits } from "./limits.ts";
import { ReasonError } from "./reasonError.ts";

export const assertAccountBelowGroupLimit = async (
  tx: Prisma.TransactionClient,
  userId: string,
) => {
  const groups = await tx.groupMember.count({ where: { userId } });
  if (groups < limits.groupsPerAccount) return;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `An account can be in at most ${limits.groupsPerAccount} groups. Leave a group before creating or joining another.`,
    cause: new ReasonError("GROUP_LIMIT_REACHED"),
  });
};
