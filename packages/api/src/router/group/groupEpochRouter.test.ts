import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
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

type WrappedKeyFindFirstArgs = {
  select: {
    algorithm: true;
    createdAt: true;
    ephemeralPublicKey: true;
    groupEpochId: true;
    nonce: true;
    recipientDeviceId: true;
    wrappedKey: true;
  };
  where: {
    groupEpoch: {
      groupId: string;
    };
    groupEpochId: string;
    recipientDevice: {
      userId: string;
    };
    recipientDeviceId: string;
  };
};

type WrappedKeyRecord = {
  algorithm: typeof WRAPPED_EPOCH_KEY_ALGORITHM;
  createdAt: Date;
  ephemeralPublicKey: string;
  groupEpochId: string;
  nonce: string;
  recipientDeviceId: string;
  wrappedKey: string;
};

type BucketState = {
  expiresAt: number;
  lastMs: number;
  tokens: number;
};

class FakeRedis {
  private readonly buckets = new Map<string, BucketState>();

  public async send(command: string, args: string[]): Promise<string[]> {
    if (command !== "EVAL") {
      throw new Error(`Unsupported command: ${command}`);
    }

    const [, , key, nowMsValue, limitValue, windowMsValue, costValue, shouldConsumeValue] = args;

    if (!key || !nowMsValue || !limitValue || !windowMsValue || !costValue || !shouldConsumeValue) {
      throw new Error("Missing EVAL arguments.");
    }

    const nowMs = Number(nowMsValue);
    const limit = Number(limitValue);
    const windowMs = Number(windowMsValue);
    const cost = Number(costValue);
    const shouldConsume = shouldConsumeValue === "1";
    const refillRate = limit / windowMs;
    const existingBucket = this.buckets.get(key);
    const activeBucket =
      existingBucket && existingBucket.expiresAt > nowMs
        ? existingBucket
        : { expiresAt: nowMs + windowMs, lastMs: nowMs, tokens: limit };
    const refilledTokens =
      nowMs > activeBucket.lastMs
        ? Math.min(limit, activeBucket.tokens + (nowMs - activeBucket.lastMs) * refillRate)
        : activeBucket.tokens;
    const remainingTokens =
      shouldConsume && refilledTokens >= cost ? refilledTokens - cost : refilledTokens;
    const allowed = refilledTokens >= cost;
    const retryAfterMs = allowed ? 0 : Math.ceil((cost - remainingTokens) / refillRate);
    const resetAfterMs = Math.ceil(Math.max(0, limit - remainingTokens) / refillRate);

    this.buckets.set(key, {
      expiresAt: nowMs + Math.max(windowMs, resetAfterMs),
      lastMs: nowMs,
      tokens: remainingTokens,
    });

    return [
      allowed ? "1" : "0",
      String(limit),
      String(Math.max(0, Math.floor(remainingTokens))),
      String(Math.max(0, retryAfterMs)),
      String(Math.max(0, resetAfterMs)),
    ];
  }

  public async del(...keys: string[]): Promise<number> {
    let deletedKeys = 0;

    keys.forEach((key) => {
      if (this.buckets.delete(key)) {
        deletedKeys += 1;
      }
    });

    return deletedKeys;
  }

  public close(): void {}
}

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

const createWrappedKeyFindFirstMock = (result: WrappedKeyRecord | null) =>
  mock(async (_args: WrappedKeyFindFirstArgs) => result);

let originalBetterAuthUrl: string | undefined;
let originalBetterAuthSecret: string | undefined;

const createCaller = async ({
  groupFindUniqueMock,
  wrappedKeyFindFirstMock,
}: {
  groupFindUniqueMock: ReturnType<typeof createGroupFindUniqueMock>;
  wrappedKeyFindFirstMock: ReturnType<typeof createWrappedKeyFindFirstMock>;
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
      groupEpochRecipientKey: {
        findFirst: wrappedKeyFindFirstMock,
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
    wrappedKeyFindFirstMock,
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
    const { caller, groupFindUniqueMock, wrappedKeyFindFirstMock } = await createCaller({
      groupFindUniqueMock: createGroupFindUniqueMock(false),
      wrappedKeyFindFirstMock: createWrappedKeyFindFirstMock(null),
    });

    await expect(
      caller.groupEpoch.getWrappedKey({
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
    expect(wrappedKeyFindFirstMock).not.toHaveBeenCalled();
  });

  test("returns null when the caller is a member without a wrapped key", async () => {
    const { caller, wrappedKeyFindFirstMock } = await createCaller({
      groupFindUniqueMock: createGroupFindUniqueMock(true),
      wrappedKeyFindFirstMock: createWrappedKeyFindFirstMock(null),
    });

    await expect(
      caller.groupEpoch.getWrappedKey({
        deviceId: "device-1",
        epochId: "epoch-1",
        groupId: "group-1",
      }),
    ).resolves.toBeNull();
    expect(wrappedKeyFindFirstMock).toHaveBeenCalledWith({
      select: {
        algorithm: true,
        createdAt: true,
        ephemeralPublicKey: true,
        groupEpochId: true,
        nonce: true,
        recipientDeviceId: true,
        wrappedKey: true,
      },
      where: {
        groupEpoch: {
          groupId: "group-1",
        },
        groupEpochId: "epoch-1",
        recipientDevice: {
          userId: "user-1",
        },
        recipientDeviceId: "device-1",
      },
    });
  });

  test("getWrappedKey returns epochId in the wrapped key shape", async () => {
    const wrappedKeyCreatedAt = new Date("2026-03-26T12:00:00.000Z");
    const { caller, wrappedKeyFindFirstMock } = await createCaller({
      groupFindUniqueMock: createGroupFindUniqueMock(true),
      wrappedKeyFindFirstMock: createWrappedKeyFindFirstMock({
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
        createdAt: wrappedKeyCreatedAt,
        ephemeralPublicKey: "ephemeral-public-key",
        groupEpochId: "epoch-1",
        nonce: "nonce-1",
        recipientDeviceId: "device-1",
        wrappedKey: "wrapped-key-1",
      }),
    });

    const result = await caller.groupEpoch.getWrappedKey({
      deviceId: "device-1",
      epochId: "epoch-1",
      groupId: "group-1",
    });

    expect(wrappedKeyFindFirstMock).toHaveBeenCalledWith({
      select: {
        algorithm: true,
        createdAt: true,
        ephemeralPublicKey: true,
        groupEpochId: true,
        nonce: true,
        recipientDeviceId: true,
        wrappedKey: true,
      },
      where: {
        groupEpoch: {
          groupId: "group-1",
        },
        groupEpochId: "epoch-1",
        recipientDevice: {
          userId: "user-1",
        },
        recipientDeviceId: "device-1",
      },
    });
    expect(result).toEqual({
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      createdAt: wrappedKeyCreatedAt,
      ephemeralPublicKey: "ephemeral-public-key",
      epochId: "epoch-1",
      nonce: "nonce-1",
      recipientDeviceId: "device-1",
      wrappedKey: "wrapped-key-1",
    });
  });
});
