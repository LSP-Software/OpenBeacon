import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { PAYLOAD_ENCRYPTION_ALGORITHM } from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const validNonce = Buffer.alloc(24, 1).toString("base64");

const createGroupFindUniqueMock = (isMember: boolean) =>
  mock(async () =>
    isMember
      ? {
          groupMembers: [
            {
              id: "group-member-1",
              role: "OWNER",
              userId: "user-1",
            },
          ],
          id: "group-1",
        }
      : {
          groupMembers: [],
          id: "group-1",
        },
  );

let originalBetterAuthUrl: string | undefined;
let originalBetterAuthSecret: string | undefined;

const createCaller = async ({
  createManyMock,
  findManyDevicesMock,
  findManyEpochsMock,
  findManyPayloadsMock,
  groupFindUniqueMock,
  queryRawMock,
}: {
  createManyMock?: ReturnType<typeof mock>;
  findManyDevicesMock?: ReturnType<typeof mock>;
  findManyEpochsMock?: ReturnType<typeof mock>;
  findManyPayloadsMock?: ReturnType<typeof mock>;
  groupFindUniqueMock: ReturnType<typeof createGroupFindUniqueMock>;
  queryRawMock?: ReturnType<typeof mock>;
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
    now: () => 0,
  });
  const context = {
    cache,
    clientIp: "203.0.113.10",
    db: {
      $queryRaw: queryRawMock ?? mock(async () => []),
      group: {
        findUnique: groupFindUniqueMock,
      },
      groupEncryptedPayload: {
        createMany: createManyMock ?? mock(async () => ({ count: 0 })),
        findMany: findManyPayloadsMock ?? mock(async () => []),
      },
      groupEpoch: {
        findMany: findManyEpochsMock ?? mock(async () => [{ id: "epoch-1" }]),
      },
      userDevice: {
        findMany: findManyDevicesMock ?? mock(async () => [{ id: "device-1", userId: "user-1" }]),
      },
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
    groupFindUniqueMock,
    queryRawMock,
  };
};

describe("groupTrackingRouter", () => {
  beforeEach(() => {
    originalBetterAuthUrl = process.env.BETTER_AUTH_URL;
    originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = "test-secret-000000000000000000000000";
  });

  afterEach(() => {
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

  test("forbids non-members from uploading", async () => {
    const createManyMock = mock(async () => ({ count: 0 }));
    const {
      caller,
      createManyMock: createMany,
      groupFindUniqueMock,
    } = await createCaller({
      createManyMock,
      groupFindUniqueMock: createGroupFindUniqueMock(false),
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
    expect(groupFindUniqueMock).toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  test("uploadBatch inserts for members and returns accepted ids", async () => {
    const createManyMock = mock(async () => ({ count: 1 }));
    const findManyPayloadsMock = mock(async () => []);
    const { caller } = await createCaller({
      createManyMock,
      findManyPayloadsMock,
      groupFindUniqueMock: createGroupFindUniqueMock(true),
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
      duplicates: [],
    });
    expect(createManyMock).toHaveBeenCalled();
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
      groupFindUniqueMock: createGroupFindUniqueMock(true),
    });

    await expect(caller.groupTracking.poll({ groupId: "group-1" })).resolves.toEqual({
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
      groupFindUniqueMock: createGroupFindUniqueMock(true),
      queryRawMock,
    });

    await expect(caller.groupTracking.getLatest({ groupId: "group-1" })).resolves.toEqual({
      points: [point],
    });
    expect(queryRawMock).toHaveBeenCalled();
  });
});
