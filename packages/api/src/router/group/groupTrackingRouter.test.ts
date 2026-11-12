import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis, testRedisHashSecret } from "@openbeacon/cache/testing";
import { PAYLOAD_ENCRYPTION_ALGORITHM } from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

import { sharingDeviceRow } from "../../lib/locationSharing.testUtil.ts";

const validNonce = Buffer.alloc(24, 1).toString("base64");

const createMemberFindUniqueMock = (isMember: boolean) =>
  mock(async () => (isMember ? { id: "group-member-1", role: "OWNER", userId: "user-1" } : null));

let originalBetterAuthUrl: string | undefined;
let originalBetterAuthSecret: string | undefined;
let originalNodeEnv: string | undefined;

const createCaller = async ({
  createManyMock,
  findManyDevicesMock,
  findManyEpochsMock,
  findObsoleteEpochMock,
  findManyPayloadsMock,
  memberFindUniqueMock,
  queryRawMock,
  now = () => 0,
  pending = false,
}: {
  createManyMock?: ReturnType<typeof mock>;
  findManyDevicesMock?: ReturnType<typeof mock>;
  findManyEpochsMock?: ReturnType<typeof mock>;
  findObsoleteEpochMock?: ReturnType<typeof mock>;
  findManyPayloadsMock?: ReturnType<typeof mock>;
  memberFindUniqueMock: ReturnType<typeof createMemberFindUniqueMock>;
  queryRawMock?: ReturnType<typeof mock>;
  now?: () => number;
  pending?: boolean;
}) => {
  const [{ createTRPCRouter }, { groupTrackingRouter }] = await Promise.all([
    import("../../trpcRuntime.ts"),
    import(`./groupTrackingRouter.ts?test=${Math.random().toString(36).slice(2)}`),
  ]);
  const router = createTRPCRouter({
    groupTracking: groupTrackingRouter,
  });
  const cache = new TestOpenBeaconCache({
    redisUrl: "redis://localhost:6379",
    hashSecret: testRedisHashSecret,
    now,
  });
  const statements: string[] = [];
  const db = {
    $queryRaw: async (query: { strings: string[] }) => {
      const sql = query.strings.join("");
      statements.push(sql);
      if (sql.includes('JOIN "User" AS "account"')) return [sharingDeviceRow];
      if (sql.includes('FROM "User" WHERE')) return [];
      if (sql.includes('FROM "Group"')) return [{ id: "group-1" }];
      return queryRawMock
        ? queryRawMock(query)
        : [{ id: "group-member-1", createdAt: new Date("2026-01-01") }];
    },
    groupMember: { findUnique: memberFindUniqueMock },
    groupEncryptedPayload: {
      createMany: createManyMock ?? mock(async () => ({ count: 0 })),
      findMany: findManyPayloadsMock ?? mock(async () => []),
    },
    groupEpoch: {
      findMany: findManyEpochsMock ?? mock(async () => [{ id: "epoch-1" }]),
      findFirst: findObsoleteEpochMock ?? mock(async () => null),
    },
    userDevice: {
      findMany: findManyDevicesMock ?? mock(async () => [{ id: "device-1", userId: "user-1" }]),
      updateMany: mock(async () => ({ count: 1 })),
    },
  };
  const context = {
    cache,
    deviceId: "device-1",
    deviceActive: !pending,
    clientIp: "203.0.113.10",
    db: {
      ...db,
      $transaction: async (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
    },
    session: {
      user: {
        id: "user-1",
      },
    },
  };

  return {
    caller: router.createCaller(context as Parameters<typeof router.createCaller>[0]),
    createManyMock,
    findManyDevicesMock,
    findManyPayloadsMock,
    memberFindUniqueMock,
    queryRawMock,
    statements,
  };
};

describe("groupTrackingRouter", () => {
  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    originalBetterAuthUrl = process.env.BETTER_AUTH_URL;
    originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = "test-secret-000000000000000000000000";
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalBetterAuthUrl === undefined) {
      delete process.env.BETTER_AUTH_URL;
    } else {
      process.env.BETTER_AUTH_URL = originalBetterAuthUrl;
    }

    if (originalBetterAuthSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
    }
  });

  test("supports sustained map refreshes across sixteen groups", async () => {
    let now = 0;
    const { caller } = await createCaller({
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      now: () => now,
    });

    for (let tick = 0; tick < 36; tick += 1) {
      await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          Promise.all([
            caller.groupTracking.getLatest({ groupId: `group-${index}` }),
            caller.groupTracking.poll({ groupId: `group-${index}` }),
          ]),
        ),
      );
      now += 5_000;
    }
  });

  test("forbids non-members from uploading", async () => {
    const createManyMock = mock(async () => ({ count: 0 }));
    const {
      caller,
      createManyMock: createMany,
      memberFindUniqueMock,
    } = await createCaller({
      createManyMock,
      memberFindUniqueMock: createMemberFindUniqueMock(false),
    });

    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [
          {
            algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
            ciphertext: "ciphertext",
            clientPointId: "point-1",
            epochId: "epoch-1",
            kind: TRACKING_POINT_KIND,
            nonce: validNonce,
            senderDeviceId: "device-1",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(memberFindUniqueMock).toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  test("rejects oversized nonces before persisting tracking points", async () => {
    const createManyMock = mock(async () => ({ count: 0 }));
    const { caller } = await createCaller({
      createManyMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [
          {
            algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
            ciphertext: "ciphertext",
            clientPointId: "point-1",
            epochId: "epoch-1",
            kind: TRACKING_POINT_KIND,
            nonce: `${" ".repeat(1_000_000)}${validNonce}`,
            senderDeviceId: "device-1",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createManyMock).not.toHaveBeenCalled();
  });

  test("forbids non-members from reading tracking ciphertext", async () => {
    const findManyPayloadsMock = mock(async () => []);
    const queryRawMock = mock(async () => []);
    const { caller } = await createCaller({
      findManyPayloadsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(false),
      queryRawMock,
    });

    await expect(caller.groupTracking.poll({ groupId: "group-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.groupTracking.getLatest({ groupId: "group-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(findManyPayloadsMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  test("uploadBatch inserts for members and returns accepted ids", async () => {
    const createManyMock = mock(async () => ({ count: 1 }));
    const findManyPayloadsMock = mock(async () => []);
    const { caller } = await createCaller({
      createManyMock,
      findManyPayloadsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });

    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [
          {
            algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
            ciphertext: "ciphertext",
            clientPointId: "point-1",
            epochId: "epoch-1",
            kind: TRACKING_POINT_KIND,
            nonce: validNonce,
            senderDeviceId: "device-1",
          },
        ],
      }),
    ).resolves.toEqual({
      accepted: ["point-1"],
      discarded: [],
      duplicates: [],
      expired: [],
      keyState: expect.any(String),
    });
    expect(createManyMock).toHaveBeenCalled();
  });

  test("uploadBatch still succeeds without a key state when the key-state query fails", async () => {
    const createManyMock = mock(async () => ({ count: 1 }));
    const { caller } = await createCaller({
      createManyMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      queryRawMock: mock(async (query: { strings: string[] }) => {
        if (query.strings.join("").includes("AccountHistoryKey")) {
          throw new Error("key state query failed");
        }
        return [{ id: "group-member-1", createdAt: new Date("2026-01-01") }];
      }),
    });

    const result = await caller.groupTracking.uploadBatch({
      groupId: "group-1",
      points: [
        {
          algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
          ciphertext: "ciphertext",
          clientPointId: "point-1",
          epochId: "epoch-1",
          kind: TRACKING_POINT_KIND,
          nonce: validNonce,
          senderDeviceId: "device-1",
        },
      ],
    });
    expect(result).toEqual({ accepted: ["point-1"], discarded: [], duplicates: [], expired: [] });
    expect(result).not.toHaveProperty("keyState");
    expect(createManyMock).toHaveBeenCalled();
  });

  test("uploadBatch answers without a key state when the key-state query stalls", async () => {
    const createManyMock = mock(async () => ({ count: 1 }));
    const { caller } = await createCaller({
      createManyMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      queryRawMock: mock(async (query: { strings: string[] }) => {
        if (query.strings.join("").includes("AccountHistoryKey")) return new Promise(() => {});
        return [{ id: "group-member-1", createdAt: new Date("2026-01-01") }];
      }),
    });

    const started = Date.now();
    const result = await caller.groupTracking.uploadBatch({
      groupId: "group-1",
      points: [
        {
          algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
          ciphertext: "ciphertext",
          clientPointId: "point-1",
          epochId: "epoch-1",
          kind: TRACKING_POINT_KIND,
          nonce: validNonce,
          senderDeviceId: "device-1",
        },
      ],
    });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(result).toEqual({ accepted: ["point-1"], discarded: [], duplicates: [], expired: [] });
  }, 10_000);

  test("uploads share the group and membership locks so a group's uploads run side by side", async () => {
    const { caller, statements } = await createCaller({
      createManyMock: mock(async () => ({ count: 1 })),
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });

    await caller.groupTracking.uploadBatch({
      groupId: "group-1",
      points: [
        {
          algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
          ciphertext: "ciphertext",
          clientPointId: "point-1",
          epochId: "epoch-1",
          kind: TRACKING_POINT_KIND,
          nonce: validNonce,
          senderDeviceId: "device-1",
        },
      ],
    });

    const locks = statements
      .filter((sql) => / FOR (SHARE|UPDATE|NO KEY UPDATE)/.test(sql))
      .map((sql) => [sql.match(/FROM "(\w+)"/)?.[1], sql.match(/FOR [A-Z ]+/)?.[0]?.trim()]);
    expect(locks).toEqual([
      ["User", "FOR SHARE"],
      ["Group", "FOR SHARE"],
      ["GroupMember", "FOR SHARE"],
    ]);
  });

  test("inserts a batch in clientPointId order so overlapping uploads lock rows in the same order", async () => {
    const createManyMock = mock(async (_args: { data: Array<{ clientPointId: string }> }) => ({
      count: 3,
    }));
    const { caller } = await createCaller({
      createManyMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    const point = (clientPointId: string) => ({
      algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
      ciphertext: "ciphertext",
      clientPointId,
      epochId: "epoch-1",
      kind: TRACKING_POINT_KIND,
      nonce: validNonce,
      senderDeviceId: "device-1",
    });

    const result = await caller.groupTracking.uploadBatch({
      groupId: "group-1",
      points: [point("point-b"), point("point-c"), point("point-a")],
    });

    expect(
      createManyMock.mock.calls[0]?.[0].data.map(({ clientPointId }) => clientPointId),
    ).toEqual(["point-a", "point-b", "point-c"]);
    expect(result.accepted).toEqual(["point-b", "point-c", "point-a"]);
  });

  test("rejects an upload if membership was removed after authorization", async () => {
    const createManyMock = mock(async () => ({ count: 1 }));
    const { caller } = await createCaller({
      createManyMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      queryRawMock: mock(async () => []),
    });

    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [
          {
            algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
            ciphertext: "ciphertext",
            clientPointId: "point-1",
            epochId: "epoch-1",
            kind: TRACKING_POINT_KIND,
            nonce: validNonce,
            senderDeviceId: "device-1",
          },
        ],
      }),
    ).rejects.toThrow("You are not a member of this group");
    expect(createManyMock).not.toHaveBeenCalled();
  });

  test("refuses a Pending device on upload, poll and getLatest without reading points", async () => {
    const createManyMock = mock(async () => ({ count: 0 }));
    const findManyPayloadsMock = mock(async () => []);
    const queryRawMock = mock(async () => []);
    const { caller } = await createCaller({
      createManyMock,
      findManyPayloadsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      pending: true,
      queryRawMock,
    });
    const point = {
      algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
      ciphertext: "ciphertext",
      clientPointId: "point-1",
      epochId: "epoch-1",
      kind: TRACKING_POINT_KIND,
      nonce: validNonce,
      senderDeviceId: "device-1",
    };
    for (const request of [
      () => caller.groupTracking.uploadBatch({ groupId: "group-1", points: [point] }),
      () => caller.groupTracking.poll({ groupId: "group-1" }),
      () => caller.groupTracking.getLatest({ groupId: "group-1" }),
    ]) {
      await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(createManyMock).not.toHaveBeenCalled();
    expect(findManyPayloadsMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  test("poll returns points for members", async () => {
    const point = {
      algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
      ciphertext: "ciphertext",
      clientPointId: "point-1",
      createdAt: new Date("2026-07-13T18:00:00.000Z"),
      epochId: "epoch-1",
      id: "id-1",
      kind: TRACKING_POINT_KIND,
      nonce: validNonce,
      senderDeviceId: "device-1",
      senderUserId: "user-1",
    };
    const findManyPayloadsMock = mock(async () => [point]);
    const { caller } = await createCaller({
      findManyPayloadsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });

    await expect(caller.groupTracking.poll({ groupId: "group-1" })).resolves.toMatchObject({
      points: [point],
    });
  });

  test("getLatest uses raw DISTINCT ON query for members", async () => {
    const point = {
      algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
      ciphertext: "ciphertext",
      clientPointId: "point-1",
      createdAt: new Date("2026-07-13T18:00:00.000Z"),
      epochId: "epoch-1",
      id: "id-1",
      kind: TRACKING_POINT_KIND,
      nonce: validNonce,
      senderDeviceId: "device-1",
      senderUserId: "user-1",
    };
    const queryRawMock = mock(async () => [point]);
    const { caller } = await createCaller({
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      queryRawMock,
    });

    await expect(caller.groupTracking.getLatest({ groupId: "group-1" })).resolves.toMatchObject({
      points: [point],
    });
    expect(queryRawMock).toHaveBeenCalled();
  });
});
