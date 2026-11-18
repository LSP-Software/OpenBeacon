import { Prisma } from "@openbeacon/database";
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
      SELECT member.id, member."userId"
      FROM "GroupMember" AS member
      WHERE member."groupId" = ${groupId}
        AND member.id = ${memberId}
      FOR UPDATE
    ),
    deleted_member AS (
      DELETE FROM "GroupMember" AS member
      USING target_member, "Group" AS target_group
      WHERE member.id = target_member.id
        AND target_group.id = ${groupId}
        AND target_group."ownerId" <> target_member."userId"
      RETURNING member.id, member."userId"
    ),
    cleared_offer AS (
      UPDATE "Group" AS target_group
      SET "ownershipOfferedToId" = NULL, "ownershipOfferedAt" = NULL
      FROM deleted_member
      WHERE target_group.id = ${groupId}
        AND target_group."ownershipOfferedToId" = deleted_member."userId"
    ),
    deleted_invites AS (
      DELETE FROM "GroupMemberInvite" AS invite
      USING deleted_member
      WHERE invite."groupId" = ${groupId}
        AND invite."inviterId" = deleted_member."userId"
    ),
    deleted_shared_invites AS (
      DELETE FROM "GroupSharedInvite" AS invite
      USING deleted_member
      WHERE invite."groupId" = ${groupId}
        AND invite."creatorId" = deleted_member."userId"
        AND invite."usedAt" IS NULL
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
      message: "The group's owner can't be removed from the group.",
    });
  }
};
