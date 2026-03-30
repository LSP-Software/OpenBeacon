import { GroupRole, Prisma } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";

export const removeGroupMemberWithOwnerGuard = async ({
  db,
  groupId,
  memberId,
}: {
  db: {
    $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
  };
  groupId: string;
  memberId: string;
}) => {
  const [result] = await db.$queryRaw<
    Array<{ deleted: boolean; memberExists: boolean }>
  >(Prisma.sql`
    WITH target_member AS (
      SELECT member.id, member.role
      FROM "GroupMember" AS member
      WHERE member."groupId" = ${groupId}
        AND member.id = ${memberId}
      FOR UPDATE
    ),
    owner_rows AS (
      SELECT owner.id
      FROM "GroupMember" AS owner
      WHERE owner."groupId" = ${groupId}
        AND owner.role = ${GroupRole.OWNER}
      FOR UPDATE
    ),
    deleted_member AS (
      DELETE FROM "GroupMember" AS member
      USING target_member
      WHERE member.id = target_member.id
        AND (
          target_member.role <> ${GroupRole.OWNER}
          OR (SELECT COUNT(*) FROM owner_rows) > 1
        )
      RETURNING member.id
    )
    SELECT
      EXISTS (SELECT 1 FROM target_member) AS "memberExists",
      EXISTS (SELECT 1 FROM deleted_member) AS deleted
  `);

  if (!result?.memberExists) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Group member not found" });
  }

  if (!result.deleted) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot remove the only owner from the group.",
    });
  }
};
