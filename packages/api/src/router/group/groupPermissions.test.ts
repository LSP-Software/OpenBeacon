import { expect, mock, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupMembership: groupMembershipRouter,
});
const createCaller = (
  actorRole: "OWNER" | "ADMIN" | "MEMBER",
  targetRole: "OWNER" | "ADMIN" | "MEMBER" = "MEMBER",
) => {
  const actor = {
    id: "actor",
    userId: "actor-user",
    role: actorRole,
    user: { pendingDeletion: false },
  };
  const createMany = mock(async () => ({ count: 1 }));
  const db = {
    $queryRaw: mock(async () => [actor]),
    group: { findUnique: mock(async () => ({ id: "group", groupMembers: [actor] })) },
    groupMember: {
      findUnique: mock(async () => actor),
      findFirst: mock(async () => ({ userId: "target-user", role: targetRole })),
      findMany: mock(async () => []),
    },
    user: {
      findMany: mock(async () => [
        { id: "target-user", email: "target@example.test", receivedGroupMemberInvites: [] },
      ]),
    },
    groupMemberInvite: { createMany },
  };
  return {
    createMany,
    caller: router.createCaller({
      cache: new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 }),
      clientIp: "127.0.0.1",
      db: {
        ...db,
        $transaction: async (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
      },
      session: { user: { id: actor.userId } },
    } as unknown as Parameters<typeof router.createCaller>[0]),
  };
};

const removal = {
  groupId: "group",
  memberId: "target",
  nextEpoch: {
    createdByDeviceId: "device",
    epochId: "epoch",
    epochNumber: 1,
    recipientKeys: [
      {
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
        createdAt: new Date(),
        ephemeralPublicKey: Buffer.alloc(32).toString("base64"),
        epochId: "epoch",
        nonce: Buffer.alloc(24).toString("base64"),
        recipientDeviceId: "device",
        wrappedKey: Buffer.alloc(48).toString("base64"),
      },
    ],
  },
};

test("admins cannot remove an admin or owner", async () => {
  for (const role of ["ADMIN", "OWNER"] as const) {
    await expect(
      createCaller("ADMIN", role).caller.groupMembership.remove(removal),
    ).rejects.toThrow("Only owners can remove owners or admins.");
  }
});

test("admin invitations reject mixed roles atomically and allow members", async () => {
  const { caller, createMany } = createCaller("ADMIN");
  await expect(
    caller.groupInvites.send({
      groupId: "group",
      invites: [
        { email: "target@example.test", role: "MEMBER" },
        { email: "other@example.test", role: "ADMIN" },
      ],
    }),
  ).rejects.toThrow("Only owners can invite admins.");
  expect(createMany).not.toHaveBeenCalled();
  await caller.groupInvites.send({
    groupId: "group",
    invites: [{ email: "target@example.test", role: "MEMBER" }],
  });
  expect(createMany).toHaveBeenCalledWith({
    data: [
      { inviterId: "actor-user", recipientId: "target-user", groupId: "group", role: "MEMBER" },
    ],
  });
});

test("owners can invite admins and members cannot invite", async () => {
  const owner = createCaller("OWNER");
  await owner.caller.groupInvites.send({
    groupId: "group",
    invites: [{ email: "target@example.test", role: "ADMIN" }],
  });
  expect(owner.createMany).toHaveBeenCalledWith({
    data: [
      { inviterId: "actor-user", recipientId: "target-user", groupId: "group", role: "ADMIN" },
    ],
  });
  const member = createCaller("MEMBER");
  await expect(
    member.caller.groupInvites.send({
      groupId: "group",
      invites: [{ email: "target@example.test", role: "MEMBER" }],
    }),
  ).rejects.toThrow();
  expect(member.createMany).not.toHaveBeenCalled();
});

test("charges for submitted invitees without revealing account matches", async () => {
  const { caller, createMany } = createCaller("OWNER");
  const batch = (count: number, email: string) => ({
    groupId: "group",
    invites: Array.from({ length: count }, () => ({ email, role: "MEMBER" as const })),
  });
  const known = await caller.groupInvites.send(batch(50, "target@example.test"));
  const unknown = await caller.groupInvites.send(batch(14, "unknown@example.test"));
  expect(unknown).toEqual(known);
  expect(createMany.mock.calls[0]?.[0].data).toHaveLength(1);
  expect(createMany.mock.calls[1]?.[0].data).toHaveLength(0);
  await caller.groupInvites.send(batch(32, "unknown@example.test"));
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  await expect(caller.groupInvites.send(batch(1, "target@example.test"))).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
  warning.mockRestore();
  expect(createMany).toHaveBeenCalledTimes(3);
});
