import { expect, mock, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis, testRedisHashSecret, UnavailableRedis } from "@openbeacon/cache/testing";
import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

class UnavailableCache extends OpenBeaconCache {
  protected override createRedisClient(): UnavailableRedis {
    return new UnavailableRedis();
  }
}

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupMembership: groupMembershipRouter,
});
const createCaller = (
  actorRole: "ADMIN" | "EDITOR" | "MEMBER",
  targetRole: "ADMIN" | "EDITOR" | "MEMBER" = "MEMBER",
  Cache: typeof TestCache = TestCache,
) => {
  const actor = {
    id: "actor",
    userId: "actor-user",
    role: actorRole,
    user: { pendingDeletion: false },
  };
  const createMany = mock(async () => ({ count: 1 }));
  const db = {
    $queryRaw: mock(async (query: { strings: string[] }) =>
      query.strings.join("").includes('AS "used"') ? [{ used: 1 }] : [actor],
    ),
    group: {
      findUniqueOrThrow: mock(async () => ({
        owner: { id: "owner-user", name: "Owner", seats: 2 },
      })),
    },
    groupMember: {
      findUnique: mock(async () => actor),
      findFirst: mock(async () => ({
        userId: "target-user",
        role: targetRole,
        group: { ownerId: "owner-user" },
      })),
      findMany: mock(async () => []),
    },
    user: {
      findMany: mock(async () => [
        { id: "target-user", email: "target@example.test", receivedGroupMemberInvites: [] },
      ]),
    },
    groupMemberInvite: { createMany, deleteMany: async () => ({ count: 0 }) },
  };
  return {
    createMany,
    caller: router.createCaller({
      cache: new Cache({
        redisUrl: "redis://localhost:6379",
        hashSecret: testRedisHashSecret,
        now: () => 0,
      }),
      clientIp: "127.0.0.1",
      db: {
        ...db,
        $transaction: async (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
      },
      deviceId: "actor-device",
      deviceActive: true,
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
    historyKeys: [],
    recipientKeys: [
      {
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
        createdAt: new Date(),
        ephemeralPublicKey: Buffer.alloc(32).toString("base64"),
        epochId: "epoch",
        recipientDeviceId: "device",
        senderPublicKey: Buffer.alloc(32).toString("base64"),
        wrappedKey: Buffer.alloc(48).toString("base64"),
      },
    ],
  },
};

test("editors cannot remove an Admin or Editor", async () => {
  for (const role of ["EDITOR", "ADMIN"] as const) {
    await expect(
      createCaller("EDITOR", role).caller.groupMembership.remove(removal),
    ).rejects.toThrow("Only Admins can remove Admins or Editors.");
  }
});

test("editor invitations reject mixed roles atomically and allow members", async () => {
  const { caller, createMany } = createCaller("EDITOR");
  await expect(
    caller.groupInvites.send({
      groupId: "group",
      invites: [
        { email: "target@example.test", role: "MEMBER" },
        { email: "other@example.test", role: "EDITOR" },
      ],
    }),
  ).rejects.toThrow("Only Admins can invite Editors.");
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

test("admins can invite editors and members cannot invite", async () => {
  const owner = createCaller("ADMIN");
  await owner.caller.groupInvites.send({
    groupId: "group",
    invites: [{ email: "target@example.test", role: "EDITOR" }],
  });
  expect(owner.createMany).toHaveBeenCalledWith({
    data: [
      { inviterId: "actor-user", recipientId: "target-user", groupId: "group", role: "EDITOR" },
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
  const { caller, createMany } = createCaller("ADMIN");
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

test("invitations still send with a log line while Redis is unavailable", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  const { caller, createMany } = createCaller("ADMIN", "MEMBER", UnavailableCache);
  await caller.groupInvites.send({
    groupId: "group",
    invites: [{ email: "target@example.test", role: "MEMBER" }],
  });
  expect(createMany).toHaveBeenCalledTimes(1);
  expect(error.mock.calls).toEqual([
    [
      "[rate-limit] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so groupInvites.send is allowed",
    ],
    [
      "[rate-limit] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so groupInvites.send.recipients is allowed",
    ],
  ]);
  error.mockRestore();
});
