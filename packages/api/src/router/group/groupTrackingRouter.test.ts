import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis, testRedisHashSecret, UnavailableRedis } from "@openbeacon/cache/testing";
import type { TRACKING_POINT_ROLES } from "@openbeacon/schemas";
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

import { parseClientPointId } from "../../lib/groupTracking.ts";
import { sharingDeviceRow } from "../../lib/locationSharing.testUtil.ts";
import { testClientPointId } from "../../lib/trackingPoints.testUtil.ts";

const validNonce = Buffer.alloc(24, 1).toString("base64");

const createMemberFindUniqueMock = (isMember: boolean) =>
  mock(async () => (isMember ? { id: "group-member-1", role: "OWNER", userId: "user-1" } : null));

const pointIdsOf = (clientPointIds: string[]) =>
  clientPointIds.map((clientPointId) => parseClientPointId(clientPointId).pointId.toString());

const storedPoints = (stored: string[] = []) =>
  mock(async (pointIds: string[], update: boolean, streamIds: string[] = []) =>
    pointIds
      .map((pointId, index) => ({
        inserted: !pointIdsOf(stored).includes(pointId),
        pointId,
        streamId: streamIds[index] ?? "1",
      }))
      .filter((row) => update || row.inserted),
  );

let originalBetterAuthUrl: string | undefined;
let originalBetterAuthSecret: string | undefined;
let originalNodeEnv: string | undefined;

const createCaller = async ({
  insertPointsMock,
  findManyDevicesMock,
  findManyEpochsMock,
  findObsoleteEpochMock,
  latestRows = [],
  memberFindUniqueMock,
  queryRawMock,
  now = () => 0,
  pending = false,
  redisAvailable = true,
  alreadyStored = [],
}: {
  insertPointsMock?: ReturnType<typeof storedPoints>;
  findManyDevicesMock?: ReturnType<typeof mock>;
  findManyEpochsMock?: ReturnType<typeof mock>;
  findObsoleteEpochMock?: ReturnType<typeof mock>;
  latestRows?: unknown[];
  memberFindUniqueMock: ReturnType<typeof createMemberFindUniqueMock>;
  queryRawMock?: ReturnType<typeof mock>;
  now?: () => number;
  pending?: boolean;
  redisAvailable?: boolean;
  alreadyStored?: string[];
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
    $queryRaw: async (query: { strings: string[]; values: unknown[] }) => {
      const sql = query.strings.join("");
      statements.push(sql);
      if (sql.includes('JOIN "User" AS "account"')) {
        return [sharingDeviceRow, { ...sharingDeviceRow, deviceId: "device-2" }];
      }
      if (sql.includes('FROM "TrackingPoint" AS "point"')) {
        const stored = pointIdsOf(alreadyStored);
        return (query.values[1] as string[])
          .filter((pointId) => stored.includes(pointId))
          .map((pointId) => ({ streamId: "1", pointId }));
      }
      if (sql.includes('INSERT INTO "TrackingPoint"')) {
        return (insertPointsMock ?? storedPoints())(
          query.values[2] as string[],
          sql.includes("DO UPDATE"),
          query.values[1] as string[],
        );
      }
      if (sql.includes('INSERT INTO "Tracking')) return [];
      if (sql.includes('FROM "TrackingStream"')) {
        const [, epochIds, senderDeviceIds, revisionPrefixes] = query.values as [
          string,
          string[],
          string[],
          string[],
        ];
        return epochIds.map((epochId, index) => ({
          epochId,
          id: "1",
          revisionPrefix: revisionPrefixes[index],
          senderDeviceId: senderDeviceIds[index],
        }));
      }
      if (sql.includes('FROM "TrackingLatestPoint"')) return latestRows;
      if (sql.includes('FROM "User" WHERE')) return [];
      if (sql.includes('FROM "Group"')) return [{ id: "group-1" }];
      return queryRawMock
        ? queryRawMock(query)
        : [{ id: "group-member-1", createdAt: new Date("2026-01-01") }];
    },
    group: { findUnique: mock(async () => ({ id: "group-1" })) },
    groupMember: {
      findUnique: memberFindUniqueMock,
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
    findManyDevicesMock,
    insertPointsMock,
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

  const trackingPoint = (seed: string, role: (typeof TRACKING_POINT_ROLES)[number] = "POINT") => ({
    ciphertext: Buffer.alloc(39, 2).toString("base64"),
    clientPointId: testClientPointId(seed),
    epochId: "epoch-1",
    nonce: validNonce,
    role,
    senderDeviceId: "device-1",
  });
  const trackingPoints = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => trackingPoint(`${prefix}-${index}`));
  const uploadLimitReached = {
    code: "TOO_MANY_REQUESTS",
    cause: { reason: "UPLOAD_LIMIT_REACHED" },
  };
  const allowance = (groupId = "group-1", deviceId = "device-1") => ({
    namespace: "groupTracking.historyAllowance",
    identifier: { type: "deviceGroup" as const, deviceId, groupId },
    limit: 2_880,
    windowMs: 86_400_000,
  });

  test("allows 2,000 points a minute per user, whatever the batch sizes", async () => {
    const insertPointsMock = storedPoints();
    const { caller } = await createCaller({
      insertPointsMock,
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
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [trackingPoint("one-more")],
      }),
    ).rejects.toMatchObject(uploadLimitReached);

    expect(insertPointsMock).toHaveBeenCalledTimes(20);
    expect(warn.mock.calls).toContainEqual([
      "[rate-limit] upload limit reached",
      { userId: "user-1", limit: "points per minute" },
    ]);
    warn.mockRestore();
  });

  test("discards history points over a device's 2,880 a day in a group, oldest kept", async () => {
    let now = 0;
    const insertPointsMock = storedPoints();
    const { cache, caller } = await createCaller({
      insertPointsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      now: () => now,
    });
    const take = spyOn(cache.rateLimits, "take");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await cache.rateLimits.take({ ...allowance(), cost: 2_878 });
    take.mockClear();

    const [first, second, third] = trackingPoints("over", 3);
    const live = trackingPoint("over-live", "LIVE");
    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [first!, live, second!, third!],
      }),
    ).resolves.toMatchObject({
      accepted: [first!.clientPointId, live.clientPointId, second!.clientPointId],
      discarded: [third!.clientPointId],
      duplicates: [],
    });
    expect(take).toHaveBeenCalledWith({ ...allowance(), cost: 3 }, { whenUnavailable: "allow" });
    expect(insertPointsMock.mock.calls[0]?.[0]).toEqual(
      pointIdsOf([first!.clientPointId, second!.clientPointId]).sort(),
    );
    expect(warn.mock.calls).toContainEqual([
      "[rate-limit] history allowance reached",
      { userId: "user-1", discarded: 1 },
    ]);

    now = 30_000;
    const refilled = trackingPoints("refilled", 2);
    await expect(
      caller.groupTracking.uploadBatch({ groupId: "group-1", points: refilled }),
    ).resolves.toMatchObject({
      accepted: [refilled[0]!.clientPointId],
      discarded: [refilled[1]!.clientPointId],
    });
    warn.mockRestore();
  });

  test("duplicates, stay updates and live rows don't use the allowance", async () => {
    const stay = trackingPoint("stored-stay", "STAY");
    const duplicate = trackingPoint("stored-point");
    const { cache, caller } = await createCaller({
      alreadyStored: [stay.clientPointId, duplicate.clientPointId],
      insertPointsMock: storedPoints([duplicate.clientPointId]),
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    await cache.rateLimits.take({ ...allowance(), cost: 2_880 });
    const live = trackingPoint("live", "LIVE");

    await expect(
      caller.groupTracking.uploadBatch({ groupId: "group-1", points: [duplicate, stay, live] }),
    ).resolves.toMatchObject({
      accepted: [stay.clientPointId, live.clientPointId],
      discarded: [],
      duplicates: [duplicate.clientPointId],
    });

    const newStay = trackingPoint("new-stay", "STAY");
    await expect(
      caller.groupTracking.uploadBatch({ groupId: "group-1", points: [newStay] }),
    ).resolves.toMatchObject({ accepted: [], discarded: [newStay.clientPointId] });
  });

  test("points another upload stored first give their allowance back", async () => {
    const raced = trackingPoint("raced-point");
    const racedStay = trackingPoint("raced-stay", "STAY");
    const fresh = trackingPoint("fresh-point");
    const { cache, caller } = await createCaller({
      insertPointsMock: storedPoints([raced.clientPointId, racedStay.clientPointId]),
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    const take = spyOn(cache.rateLimits, "take");

    await expect(
      caller.groupTracking.uploadBatch({ groupId: "group-1", points: [raced, racedStay, fresh] }),
    ).resolves.toMatchObject({
      accepted: [racedStay.clientPointId, fresh.clientPointId],
      discarded: [],
      duplicates: [raced.clientPointId],
    });
    expect(take).toHaveBeenCalledWith({ ...allowance(), cost: 3 }, { whenUnavailable: "allow" });
    await expect(cache.rateLimits.peek(allowance())).resolves.toMatchObject({ remaining: 2_879 });
  });

  test("an upload that rolls back gives all its allowance back", async () => {
    const { cache, caller } = await createCaller({
      insertPointsMock: mock(async () => {
        throw new Error("deadlock detected");
      }),
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });

    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: trackingPoints("rollback", 3),
      }),
    ).rejects.toThrow("deadlock detected");
    await expect(cache.rateLimits.peek(allowance())).resolves.toMatchObject({ remaining: 2_880 });
  });

  test("an upload still succeeds when giving allowance back fails", async () => {
    const raced = trackingPoint("raced-point");
    const { cache, caller } = await createCaller({
      insertPointsMock: storedPoints([raced.clientPointId]),
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    const refund = spyOn(cache.rateLimits, "refund").mockRejectedValue(new Error("Redis down"));
    const error = spyOn(console, "error").mockImplementation(() => {});

    await expect(
      caller.groupTracking.uploadBatch({ groupId: "group-1", points: [raced] }),
    ).resolves.toMatchObject({ duplicates: [raced.clientPointId] });
    expect(refund).toHaveBeenCalledWith({ ...allowance(), cost: 1 });
    expect(error.mock.calls.map(([line]) => line)).toContain(
      "[rate-limit] could not give back history allowance",
    );
    error.mockRestore();
  });

  test("each device has its own allowance in each group", async () => {
    const { cache, caller } = await createCaller({
      findManyDevicesMock: mock(async () => [
        { id: "device-1", userId: "user-1" },
        { id: "device-2", userId: "user-1" },
      ]),
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    await cache.rateLimits.take({ ...allowance(), cost: 2_880 });
    const blocked = trackingPoint("device-1");
    const otherDevice = { ...trackingPoint("device-2"), senderDeviceId: "device-2" };

    await expect(
      caller.groupTracking.uploadBatch({ groupId: "group-1", points: [blocked, otherDevice] }),
    ).resolves.toMatchObject({
      accepted: [otherDevice.clientPointId],
      discarded: [blocked.clientPointId],
    });
    await expect(cache.rateLimits.peek(allowance("group-2"))).resolves.toMatchObject({
      remaining: 2_880,
    });
    await expect(cache.rateLimits.peek(allowance("group-1", "device-2"))).resolves.toMatchObject({
      remaining: 2_879,
    });
  });

  test("uploads carry on, with a log line, when Redis is unavailable", async () => {
    const insertPointsMock = storedPoints();
    const { caller } = await createCaller({
      insertPointsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      redisAvailable: false,
    });
    const error = spyOn(console, "error").mockImplementation(() => {});

    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [trackingPoint("point-1")],
      }),
    ).resolves.toMatchObject({ accepted: [testClientPointId("point-1")] });

    expect(insertPointsMock).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.map(([line]) => line)).toEqual(
      expect.arrayContaining([
        "[rate-limit] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so groupTracking.uploadBatch.points is allowed",
        "[rate-limit] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so groupTracking.historyAllowance is allowed",
      ]),
    );
    error.mockRestore();
  });

  test("forbids non-members from uploading", async () => {
    const insertPointsMock = storedPoints();
    const {
      caller,
      insertPointsMock: insertPoints,
      memberFindUniqueMock,
    } = await createCaller({
      insertPointsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(false),
    });

    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [trackingPoint("point-1")],
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(memberFindUniqueMock).toHaveBeenCalled();
    expect(insertPoints).not.toHaveBeenCalled();
  });

  test("rejects oversized nonces before persisting tracking points", async () => {
    const insertPointsMock = storedPoints();
    const { caller } = await createCaller({
      insertPointsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [
          {
            ...trackingPoint("point-1"),
            nonce: `${" ".repeat(1_000_000)}${validNonce}`,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(insertPointsMock).not.toHaveBeenCalled();
  });

  test("forbids non-members from reading tracking ciphertext", async () => {
    const queryRawMock = mock(async () => []);
    const { caller, statements } = await createCaller({
      memberFindUniqueMock: createMemberFindUniqueMock(false),
      queryRawMock,
    });

    await expect(caller.groupTracking.poll({ groupId: "group-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.groupTracking.getLatest({ groupId: "group-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(statements.some((sql) => sql.includes("TrackingLatestPoint"))).toBe(false);
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  test("uploadBatch inserts for members and returns accepted ids", async () => {
    const insertPointsMock = storedPoints();
    const { caller } = await createCaller({
      insertPointsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });

    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [trackingPoint("point-1")],
      }),
    ).resolves.toEqual({
      accepted: [testClientPointId("point-1")],
      discarded: [],
      duplicates: [],
      expired: [],
      keyState: expect.any(String),
    });
    expect(insertPointsMock).toHaveBeenCalled();
  });

  test("uploadBatch still succeeds without a key state when the key-state query fails", async () => {
    const insertPointsMock = storedPoints();
    const { caller } = await createCaller({
      insertPointsMock,
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
      points: [trackingPoint("point-1")],
    });
    expect(result).toEqual({
      accepted: [testClientPointId("point-1")],
      discarded: [],
      duplicates: [],
      expired: [],
    });
    expect(result).not.toHaveProperty("keyState");
    expect(insertPointsMock).toHaveBeenCalled();
  });

  test("uploadBatch answers without a key state when the key-state query stalls", async () => {
    const insertPointsMock = storedPoints();
    const { caller } = await createCaller({
      insertPointsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      queryRawMock: mock(async (query: { strings: string[] }) => {
        if (query.strings.join("").includes("AccountHistoryKey")) return new Promise(() => {});
        return [{ id: "group-member-1", createdAt: new Date("2026-01-01") }];
      }),
    });

    const started = Date.now();
    const result = await caller.groupTracking.uploadBatch({
      groupId: "group-1",
      points: [trackingPoint("point-1")],
    });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(result).toEqual({
      accepted: [testClientPointId("point-1")],
      discarded: [],
      duplicates: [],
      expired: [],
    });
  }, 10_000);

  test("uploads share the group and membership locks so a group's uploads run side by side", async () => {
    const { caller, statements } = await createCaller({
      insertPointsMock: storedPoints(),
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });

    await caller.groupTracking.uploadBatch({
      groupId: "group-1",
      points: [trackingPoint("point-1")],
    });

    const locks = statements
      .filter((sql) => / FOR (SHARE|UPDATE|NO KEY UPDATE)/.test(sql))
      .map((sql) => [sql.match(/FROM "(\w+)"/)?.[1], sql.match(/FOR [A-Z ]+/)?.[0]?.trim()]);
    expect(locks).toEqual([
      ["User", "FOR SHARE"],
      ["Group", "FOR SHARE"],
      ["GroupMember", "FOR SHARE"],
      ["TrackingStream", "FOR SHARE"],
    ]);
  });

  test("inserts a batch in stream and point ID order so overlapping uploads lock rows in the same order", async () => {
    const insertPointsMock = storedPoints();
    const { caller } = await createCaller({
      insertPointsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    const points = ["point-b", "point-c", "point-a"].map((seed) => trackingPoint(seed));

    const result = await caller.groupTracking.uploadBatch({
      groupId: "group-1",
      points,
    });

    const pointIds = points.map(({ clientPointId }) => parseClientPointId(clientPointId).pointId);
    expect(insertPointsMock.mock.calls[0]?.[0]).toEqual(
      pointIds
        .toSorted((first, second) => Number(first > second) - Number(first < second))
        .map(String),
    );
    expect(result.accepted).toEqual(points.map(({ clientPointId }) => clientPointId));
  });

  test("rejects an upload if membership was removed after authorization", async () => {
    const insertPointsMock = storedPoints();
    const { caller } = await createCaller({
      insertPointsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      queryRawMock: mock(async () => []),
    });

    await expect(
      caller.groupTracking.uploadBatch({
        groupId: "group-1",
        points: [trackingPoint("point-1")],
      }),
    ).rejects.toThrow("You are not a member of this group");
    expect(insertPointsMock).not.toHaveBeenCalled();
  });

  test("refuses a Pending device on upload, poll and getLatest without reading points", async () => {
    const insertPointsMock = storedPoints();
    const queryRawMock = mock(async () => []);
    const { caller, statements } = await createCaller({
      insertPointsMock,
      memberFindUniqueMock: createMemberFindUniqueMock(true),
      pending: true,
      queryRawMock,
    });
    const point = trackingPoint("point-1");
    for (const request of [
      () =>
        caller.groupTracking.uploadBatch({
          groupId: "group-1",
          points: [point],
        }),
      () => caller.groupTracking.poll({ groupId: "group-1" }),
      () => caller.groupTracking.getLatest({ groupId: "group-1" }),
    ]) {
      await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(insertPointsMock).not.toHaveBeenCalled();
    expect(statements.some((sql) => sql.includes("TrackingLatestPoint"))).toBe(false);
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  test("poll and getLatest split the stored payload into nonce and ciphertext", async () => {
    const latestRow = {
      epochId: "epoch-1",
      payload: new Uint8Array([...Buffer.alloc(24, 1), 7, 8, 9]),
      revisionPrefix: "",
      senderDeviceId: "device-1",
      senderUserId: "user-1",
      updatedAt: new Date("2026-07-13T18:00:00.000Z"),
    };
    const { caller } = await createCaller({
      latestRows: [latestRow],
      memberFindUniqueMock: createMemberFindUniqueMock(true),
    });
    const point = {
      ciphertext: Buffer.from([7, 8, 9]).toString("base64"),
      epochId: "epoch-1",
      nonce: validNonce,
      revisionPrefix: "",
      senderDeviceId: "device-1",
      senderUserId: "user-1",
      updatedAt: latestRow.updatedAt,
    };

    await expect(caller.groupTracking.poll({ groupId: "group-1" })).resolves.toEqual({
      cursor: { senderDeviceId: "device-1", updatedAt: latestRow.updatedAt },
      hasMore: false,
      points: [point],
      sharing: expect.any(Array),
    });
    await expect(caller.groupTracking.getLatest({ groupId: "group-1" })).resolves.toEqual({
      points: [point],
      sharing: expect.any(Array),
    });
  });
});
