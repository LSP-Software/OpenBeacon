import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { TRPCError } from "@trpc/server";

type GroupFindUniqueArgs = {
  include: {
    groupMembers: {
      where: {
        userId: string;
      };
    };
  };
  where: {
    id: string;
  };
};

type EpochFindFirstArgs = {
  where: {
    epochNumber: {
      gte: number;
    };
    groupId: string;
    id: string;
  };
};

type EpochRecord = {
  historyWraps: Array<{
    algorithm: typeof WRAPPED_EPOCH_KEY_ALGORITHM;
    createdAt: Date;
    ephemeralPublicKey: string;
    historyKey: { version: number };
    senderPublicKey: string;
    wrappedKey: string;
  }>;
  id: string;
  recipientKeys: Array<{
    algorithm: typeof WRAPPED_EPOCH_KEY_ALGORITHM;
    createdAt: Date;
    ephemeralPublicKey: string;
    recipientDeviceId: string;
    wrappedKey: string;
  }>;
  senderPublicKey: string;
};

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const createGroupFindUniqueMock = (isMember: boolean) =>
  mock(async (_args: GroupFindUniqueArgs) =>
    isMember
      ? {
          groupMembers: [
            {
              id: "group-member-1",
              joinedEpochNumber: 3,
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

const createEpochFindFirstMock = (result: EpochRecord | null) =>
  mock(async (_args: EpochFindFirstArgs) => result);

let originalBetterAuthUrl: string | undefined;
let originalBetterAuthSecret: string | undefined;

const createCaller = async ({
  groupFindUniqueMock,
  epochFindFirstMock,
}: {
  groupFindUniqueMock: ReturnType<typeof createGroupFindUniqueMock>;
  epochFindFirstMock: ReturnType<typeof createEpochFindFirstMock>;
}) => {
  const [{ createTRPCRouter }, { groupEpochRouter }] = await Promise.all([
    import("../../trpcRuntime.ts"),
    import(`./groupEpochRouter.ts?test=${Math.random().toString(36).slice(2)}`),
  ]);
  const router = createTRPCRouter({
    groupEpoch: groupEpochRouter,
  });
  const cache = new TestOpenBeaconCache({
    redisUrl: "redis://localhost:6379",
    now: () => 0,
  });
  const context = {
    cache,
    clientIp: "203.0.113.10",
    db: {
      group: {
        findUnique: groupFindUniqueMock,
      },
      groupEpoch: {
        findFirst: epochFindFirstMock,
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
    groupFindUniqueMock,
    epochFindFirstMock,
  };
};

describe("groupEpochRouter", () => {
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

  test("forbids access for non-members", async () => {
    const { caller, groupFindUniqueMock, epochFindFirstMock } = await createCaller({
      groupFindUniqueMock: createGroupFindUniqueMock(false),
      epochFindFirstMock: createEpochFindFirstMock(null),
    });

    await expect(
      caller.groupEpoch.getEpochKeyWraps({
        deviceId: "device-1",
        epochId: "epoch-1",
        groupId: "group-1",
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(groupFindUniqueMock).toHaveBeenCalledWith({
      include: {
        groupMembers: {
          where: {
            userId: "user-1",
          },
        },
      },
      where: {
        id: "group-1",
      },
    });
    expect(epochFindFirstMock).not.toHaveBeenCalled();
  });

  test("returns no wraps when the epoch is missing or before the member joined", async () => {
    const { caller, epochFindFirstMock } = await createCaller({
      groupFindUniqueMock: createGroupFindUniqueMock(true),
      epochFindFirstMock: createEpochFindFirstMock(null),
    });

    await expect(
      caller.groupEpoch.getEpochKeyWraps({
        deviceId: "device-1",
        epochId: "epoch-1",
        groupId: "group-1",
      }),
    ).resolves.toEqual({ deviceWrap: null, historyWraps: [] });
    expect(epochFindFirstMock.mock.calls[0]?.[0].where).toEqual({
      epochNumber: { gte: 3 },
      groupId: "group-1",
      id: "epoch-1",
    });
  });

  test("returns epochId and the epoch creator's public key as the device wrap's senderPublicKey", async () => {
    const createdAt = new Date("2026-03-26T12:00:00.000Z");
    const { caller } = await createCaller({
      groupFindUniqueMock: createGroupFindUniqueMock(true),
      epochFindFirstMock: createEpochFindFirstMock({
        historyWraps: [
          {
            algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
            createdAt,
            ephemeralPublicKey: "history-ephemeral-public-key",
            historyKey: { version: 2 },
            senderPublicKey: "device-public-key",
            wrappedKey: "history-wrapped-key",
          },
        ],
        id: "epoch-1",
        recipientKeys: [
          {
            algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
            createdAt,
            ephemeralPublicKey: "ephemeral-public-key",
            recipientDeviceId: "device-1",
            wrappedKey: "wrapped-key-1",
          },
        ],
        senderPublicKey: "creator-public-key",
      }),
    });

    const result = await caller.groupEpoch.getEpochKeyWraps({
      deviceId: "device-1",
      epochId: "epoch-1",
      groupId: "group-1",
    });

    expect(result).toEqual({
      deviceWrap: {
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
        createdAt,
        ephemeralPublicKey: "ephemeral-public-key",
        epochId: "epoch-1",
        recipientDeviceId: "device-1",
        senderPublicKey: "creator-public-key",
        wrappedKey: "wrapped-key-1",
      },
      historyWraps: [
        {
          algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
          createdAt,
          ephemeralPublicKey: "history-ephemeral-public-key",
          epochId: "epoch-1",
          historyKeyVersion: 2,
          senderPublicKey: "device-public-key",
          userId: "user-1",
          wrappedKey: "history-wrapped-key",
        },
      ],
    });
  });
});
