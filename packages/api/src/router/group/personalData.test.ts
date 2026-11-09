import { expect, mock, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

test("nicknames are scoped to the caller's membership and targets in the same group", async () => {
  const findMany = mock(async () => []);
  const createMany = mock(async () => ({ count: 1 }));
  const deleteMany = mock(async () => ({ count: 0 }));
  const updateMany = mock(async () => ({ count: 1 }));
  const findFirst = mock(async () => ({ id: "target" }));
  const router = createTRPCRouter({ groupMembership: groupMembershipRouter });
  const caller = router.createCaller({
    cache: new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 }),
    clientIp: "127.0.0.1",
    session: { user: { id: "user" } },
    db: {
      group: {
        findUnique: async () => ({
          id: "group",
          groupMembers: [{ id: "owner", userId: "user", role: "MEMBER" }],
        }),
      },
      groupMember: { findFirst },
      personalGroupNickname: { findMany, createMany, updateMany, deleteMany },
    },
  } as unknown as Parameters<typeof router.createCaller>[0]);
  await caller.groupMembership.nicknames({ groupId: "group" });
  expect(findMany).toHaveBeenCalledWith({
    where: { ownerId: "owner" },
    select: { targetId: true, ciphertext: true },
  });
  await caller.groupMembership.updateNickname({
    groupId: "group",
    memberId: "target",
    ciphertext: "opaque",
    expectedCiphertext: null,
  });
  expect(findFirst).toHaveBeenCalledWith({
    where: { id: "target", groupId: "group" },
    select: { id: true },
  });
  await caller.groupMembership.updateNickname({
    groupId: "group",
    memberId: "target",
    ciphertext: "new-device-ciphertext",
    expectedCiphertext: "old-device-ciphertext",
  });
  expect(updateMany).toHaveBeenCalledWith({
    where: { ownerId: "owner", targetId: "target", ciphertext: "old-device-ciphertext" },
    data: { ciphertext: "new-device-ciphertext" },
  });
  createMany.mockImplementationOnce(async () => ({ count: 0 }));
  await expect(
    caller.groupMembership.updateNickname({
      groupId: "group",
      memberId: "target",
      ciphertext: "new",
      expectedCiphertext: null,
    }),
  ).rejects.toThrow("Nickname changed");
  updateMany.mockImplementationOnce(async () => ({ count: 0 }));
  await expect(
    caller.groupMembership.updateNickname({
      groupId: "group",
      memberId: "target",
      ciphertext: "new",
      expectedCiphertext: "stale",
    }),
  ).rejects.toThrow("Nickname changed");
  await expect(
    caller.groupMembership.updateNickname({
      groupId: "group",
      memberId: "target",
      ciphertext: null,
      expectedCiphertext: "stale",
    }),
  ).rejects.toThrow("Nickname changed");
  expect(deleteMany).toHaveBeenCalledWith({
    where: { ownerId: "owner", targetId: "target", ciphertext: "stale" },
  });
  expect(createMany).toHaveBeenCalledWith({
    data: { ownerId: "owner", targetId: "target", ciphertext: "opaque" },
    skipDuplicates: true,
  });
});

test("group colors are scoped to the caller's own memberships", async () => {
  const findMany = mock(async () => [{ ciphertext: "opaque", owner: { groupId: "group" } }]);
  const upsert = mock(async () => ({}));
  const updateMany = mock(async () => ({ count: 1 }));
  const router = createTRPCRouter({ groupMembership: groupMembershipRouter });
  const caller = router.createCaller({
    cache: new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 }),
    clientIp: "127.0.0.1",
    session: { user: { id: "user" } },
    db: {
      group: {
        findUnique: async () => ({
          id: "group",
          groupMembers: [{ id: "owner", userId: "user", role: "MEMBER" }],
        }),
      },
      personalGroupColor: { findMany, upsert, updateMany },
    },
  } as unknown as Parameters<typeof router.createCaller>[0]);
  expect(await caller.groupMembership.colors()).toEqual([
    { groupId: "group", ciphertext: "opaque" },
  ]);
  expect(findMany).toHaveBeenCalledWith({
    where: { owner: { userId: "user" } },
    select: { ciphertext: true, owner: { select: { groupId: true } } },
  });
  await caller.groupMembership.updateColor({ groupId: "group", ciphertext: "next" });
  expect(upsert).toHaveBeenCalledWith({
    where: { ownerId: "owner" },
    create: { ownerId: "owner", ciphertext: "next" },
    update: { ciphertext: "next" },
  });
  await caller.groupMembership.updateColor({
    groupId: "group",
    ciphertext: "resealed",
    expectedCiphertext: "next",
  });
  expect(updateMany).toHaveBeenCalledWith({
    where: { ownerId: "owner", ciphertext: "next" },
    data: { ciphertext: "resealed" },
  });
  expect(upsert).toHaveBeenCalledTimes(1);
  updateMany.mockImplementationOnce(async () => ({ count: 0 }));
  await expect(
    caller.groupMembership.updateColor({
      groupId: "group",
      ciphertext: "resealed",
      expectedCiphertext: "stale",
    }),
  ).rejects.toThrow("Group color changed");
});
