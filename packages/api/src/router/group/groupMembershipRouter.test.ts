import { describe, expect, mock, test } from "bun:test";
import { GroupRole, type Prisma } from "@openbeacon/database";

const importGroupMemberRemovalModule = async () =>
  import(
    `./assertGroupMemberCanBeRemoved.ts?test=${Math.random().toString(36).slice(2)}`
  ) as Promise<typeof import("./assertGroupMemberCanBeRemoved.ts")>;

describe("group membership removal guard", () => {
  test("rejects removing the only owner", async () => {
    const { removeGroupMemberWithOwnerGuard } = await importGroupMemberRemovalModule();
    const queryRaw = mock(async () => [{ deleted: false, memberExists: true }]);

    await expect(
      removeGroupMemberWithOwnerGuard({
        db: {
          $queryRaw: queryRaw,
        },
        groupId: "group-1",
        memberId: "member-1",
      }),
    ).rejects.toThrow("Cannot remove the only owner from the group.");
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  test("allows removing an owner when another owner remains", async () => {
    const { removeGroupMemberWithOwnerGuard } = await importGroupMemberRemovalModule();
    const queryRaw = mock(async () => [{ deleted: true, memberExists: true }]);

    await expect(
      removeGroupMemberWithOwnerGuard({
        db: {
          $queryRaw: queryRaw,
        },
        groupId: "group-1",
        memberId: "member-1",
      }),
    ).resolves.toBeUndefined();
  });

  test("embeds the owner guard in the SQL statement", async () => {
    const { removeGroupMemberWithOwnerGuard } = await importGroupMemberRemovalModule();
    let sqlQuery: Prisma.Sql | undefined;
    const queryRaw = mock(async () => [{ deleted: true, memberExists: true }]);

    await expect(
      removeGroupMemberWithOwnerGuard({
        db: {
          $queryRaw: async (query) => {
            sqlQuery = query;
            return queryRaw(query);
          },
        },
        groupId: "group-1",
        memberId: "member-1",
      }),
    ).resolves.toBeUndefined();
    expect(sqlQuery?.strings.join("")).toContain("target_member.role <> ");
    expect(sqlQuery?.strings.join("")).toContain("COUNT(*) FROM owner_rows");
    expect(sqlQuery?.values).toContain(GroupRole.OWNER);
  });

  test("uses current Prisma table and column names", async () => {
    const { removeGroupMemberWithOwnerGuard } = await importGroupMemberRemovalModule();
    let sqlQuery: Prisma.Sql | undefined;

    await expect(
      removeGroupMemberWithOwnerGuard({
        db: {
          $queryRaw: async (query) => {
            sqlQuery = query;
            return [{ deleted: true, memberExists: true }];
          },
        },
        groupId: "group-1",
        memberId: "member-1",
      }),
    ).resolves.toBeUndefined();

    const queryText = sqlQuery?.strings.join("");
    expect(queryText).toContain('FROM "GroupMember" AS member');
    expect(queryText).toContain('WHERE member."groupId" = ');
    expect(queryText).not.toContain('"group_members"');
    expect(queryText).not.toContain('"group_id"');
  });

  test("rejects removing a missing member", async () => {
    const { removeGroupMemberWithOwnerGuard } = await importGroupMemberRemovalModule();
    const queryRaw = mock(async () => [{ deleted: false, memberExists: false }]);

    await expect(
      removeGroupMemberWithOwnerGuard({
        db: {
          $queryRaw: queryRaw,
        },
        groupId: "group-1",
        memberId: "member-1",
      }),
    ).rejects.toThrow("Group member not found");
  });
});
