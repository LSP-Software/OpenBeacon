import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis, testRedisHashSecret, UnavailableRedis } from "@openbeacon/cache/testing";
import { PAYLOAD_ENCRYPTION_ALGORITHM } from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

class UnavailableCache extends OpenBeaconCache {
  protected override createRedisClient(): UnavailableRedis {
    return new UnavailableRedis();
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
  groupCount = 1,
  redisAvailable = true,
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
  groupCount?: number;
  redisAvailable?: boolean;
}) => {
  const [{ createTRPCRouter }, { groupTrackingRouter }] = await Promise.all([
    import("../../trpcRuntime.ts"),
    import(`./groupTrackingRouter.ts?test=${Math.random().toString(36).slice(2)}`),
  ]);
  const router = createTRPCRouter({
    groupTracking: groupTrackingRouter,
  });
  const cache = new (redisAvailable ? TestOpenBeaconCache : UnavailableCache)({
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
    group: { findUnique: mock(async () => ({ id: "group-1" })) },
    groupMember: {
      count: mock(async () => groupCount),
      findUnique: memberFindUniqueMock,
    },
    groupEncryptedPayload: {
      createMany: createManyMock ?? mock(async () => ({ count: 0 })),
      findMany: findManyPayloadsMock ?? mock(async () => []),
    },
    groupEpoch: {
      findMany: findManyEpochsMock ?? mock(async () => [{ id: "epoch-1" }]),
      findFirst: findObsoleteEpochMock ?? mock(async () => null),
      findUnique: mock(async () => null),
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
    cache,
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

  const trackingPoint = (clientPointId: string) => ({
    algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
    ciphertext: "ciphertext",
    clientPointId,
    epochId: "epoch-1",
    kind: TRACKING_POINT_KIND,
    nonce: validNonce,
    senderDeviceId: "device-1",
  });
  const trackingPoints = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => trackingPoint(`${prefix}-${index}`));
  const uploadLimitReached = {
    code: "TOO_MANY_REQUESTS",
    cause: { reason: "UPLOAD_LIMIT_REACHED" },
  };
  const dailyBudget = (limit: number) => ({
    namespace: "groupTracking.uploadBatch.daily",
    identifier: { type: "userId" as const, value: "user-1" },
    limit,
    windowMs: 86_400_000,
  });

  test("allows 2,000 points a minute per user, whatever the batch sizes", async () => {
    const createManyMock = mock(async () => ({ count: 100 }));
    const { caller } = await createCaller({
      createManyMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    for (let batch = 0; batch < 20; batch += 1) {
      await caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: trackingPoints(`batch-${batch}`, 100),
      });
    }
    await expect(
      caller.groupTracking.uploadBatch({ groupId: "group-1", points: [trackingPoint("one-more")] }),
    ).rejects.toMatchObject(uploadLimitReached);

    expect(createManyMock).toHaveBeenCalledTimes(20);
    expect(warn.mock.calls).toContainEqual([
      "[rate-limit] upload limit reached",
      { userId: "user-1", limit: "points per minute" },
    ]);
    warn.mockRestore();
  });

  for (const [groupCount, budget] of [
    [3, 35_424],
    [16, 147_744],
  ] as const) {
    test(`gives a user in ${groupCount} groups a daily budget of ${budget} accepted points`, async () => {
      const createManyMock = mock(async () => ({ count: 1 }));
      const { cache, caller } = await createCaller({
        createManyMock,
        groupCount,
        memberFindUniqueMock: createMemberFindUniqueMock(true),
      });
      const consume = spyOn(cache.rateLimits, "consume");
      const warn = spyOn(console, "warn").mockImplementation(() => {});

      await caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [trackingPoint("first")],
      });
      expect(consume).toHaveBeenCalledWith(
        { ...dailyBudget(budget), cost: 1 },
        { whenUnavailable: "allow" },
      );
      await cache.rateLimits.consume({ ...dailyBudget(budget), cost: budget - 2 });
      await caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [trackingPoint("last")],
      });
      await expect(
        caller.groupTracking.uploadBatch({ groupId: "group-1", points: [trackingPoint("over")] }),
      ).rejects.toMatchObject(uploadLimitReached);

      expect(createManyMock).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls).toContainEqual([
        "[rate-limit] upload limit reached",
        { userId: "user-1", limit: "daily points" },
      ]);
      warn.mockRestore();
    });
  }

  test("points the server already has don't count towards the daily budget", async () => {
    const { cache, caller } = await createCaller({
      findManyPayloadsMock: mock(async () => [
        { clientPointId: "stored-1" },
        { clientPointId: "stored-2" },
      ]),
      groupCount: 3,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    await cache.rateLimits.consume({ ...dailyBudget(35_424), cost: 35_423 });

    const result = await caller.groupTracking.uploadBatch({
      groupId: "group-1",
      points: [trackingPoint("stored-1"), trackingPoint("stored-2"), trackingPoint("new")],
    });

    expect(result.accepted).toEqual(["new"]);
    expect(result.duplicates).toEqual(["stored-1", "stored-2"]);
  });

  test("a batch of only duplicates doesn't touch the daily budget", async () => {
    const { cache, caller } = await createCaller({
      findManyPayloadsMock: mock(async () => [{ clientPointId: "stored-1" }]),
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    await cache.rateLimits.consume({ ...dailyBudget(18_144), cost: 18_144 });

    await expect(
      caller.groupTracking.uploadBatch({ groupId: "group-1", points: [trackingPoint("stored-1")] }),
    ).resolves.toMatchObject({ duplicates: ["stored-1"] });
  });

  test("uploads carry on, with a log line, when Redis is unavailable", async () => {
    const createManyMock = mock(async () => ({ count: 1 }));
    const { caller } = await createCaller({
      createManyMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      redisAvailable: false,
    });
    const error = spyOn(console, "error").mockImplementation(() => {});

    await expect(
      caller.groupTracking.uploadBatch({ groupId: "group-1", points: [trackingPoint("point-1")] }),
    ).resolves.toMatchObject({ accepted: ["point-1"] });

    expect(createManyMock).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.map(([line]) => line)).toEqual(
      expect.arrayContaining([
        "[rate-limit] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so groupTracking.uploadBatch.points is allowed",
        "[rate-limit] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so groupTracking.uploadBatch.daily is allowed",
      ]),
    );
    error.mockRestore();
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
