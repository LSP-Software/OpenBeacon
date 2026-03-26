import { describe, expect, mock, test } from "bun:test";

const GroupRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  OWNER: "OWNER",
} as const;

mock.module("@openbeacon/database", () => ({
  GroupRole,
}));

const importAssertGroupMemberCanBeRemovedModule = async () =>
  import(
    `./assertGroupMemberCanBeRemoved.ts?test=${Math.random().toString(36).slice(2)}`
  ) as Promise<typeof import("./assertGroupMemberCanBeRemoved.ts")>;

describe("group membership removal guard", () => {
  test("rejects removing the only owner", async () => {
    const { assertGroupMemberCanBeRemoved } = await importAssertGroupMemberCanBeRemovedModule();
    const count = mock(async () => 0);

    await expect(() =>
      assertGroupMemberCanBeRemoved({
        db: {
          groupMember: {
            count,
          },
        },
        groupId: "group-1",
        memberId: "member-1",
        role: GroupRole.OWNER,
      }),
    ).toThrow("Cannot remove the only owner from the group.");
  });

  test("allows removing an owner when another owner remains", async () => {
    const { assertGroupMemberCanBeRemoved } = await importAssertGroupMemberCanBeRemovedModule();
    const count = mock(async () => 1);

    await expect(
      assertGroupMemberCanBeRemoved({
        db: {
          groupMember: {
            count,
          },
        },
        groupId: "group-1",
        memberId: "member-1",
        role: GroupRole.OWNER,
      }),
    ).resolves.toBeUndefined();
  });

  test("skips the owner check for non-owner members", async () => {
    const { assertGroupMemberCanBeRemoved } = await importAssertGroupMemberCanBeRemovedModule();
    const count = mock(async () => 0);

    await expect(
      assertGroupMemberCanBeRemoved({
        db: {
          groupMember: {
            count,
          },
        },
        groupId: "group-1",
        memberId: "member-1",
        role: GroupRole.ADMIN,
      }),
    ).resolves.toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });
});
