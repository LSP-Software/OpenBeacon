import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
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
    import("../../trpc.ts"),
    import(`./groupEpochRouter.ts?test=${Math.random().toString(36).slice(2)}`),
  ]);
  const router = createTRPCRouter({
    groupEpoch: groupEpochRouter,
  });
  const context = {
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
