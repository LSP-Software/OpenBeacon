import { describe, expect, mock, test } from "bun:test";

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

  test("allows removing a non-owner member", async () => {
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
