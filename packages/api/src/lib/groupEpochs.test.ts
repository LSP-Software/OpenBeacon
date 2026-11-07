import { describe, expect, mock, test } from "bun:test";
import { Prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  DEVICE_KEY_ALGORITHM,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import { getInviteAcceptanceContext, persistGroupEpoch, upsertUserDevice } from "./groupEpochs.ts";

const ephemeralA = createDeviceKeyPair().publicKey;
const ephemeralB = createDeviceKeyPair().publicKey;

describe("group epoch helpers", () => {
  test("registers a device without persisting a private key", async () => {
    const create = mock(async ({ data }: { data: Record<string, unknown> }) => ({
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      id: data.id as string,
      lastSeenAt: new Date("2026-03-26T12:00:00.000Z"),
      publicKey: data.publicKey as string,
      publicKeyAlgorithm: data.publicKeyAlgorithm as string,
      revokedAt: null,
      userId: data.userId as string,
    }));

    const updateMany = mock(async () => ({ count: 1 }));

    const result = await upsertUserDevice({
      db: {
        $transaction: async (run: (tx: object) => Promise<unknown>) =>
          run({ group: { updateMany }, userDevice: { create } }),
        userDevice: {
          findUnique: async () => null,
        },
      } as unknown as Parameters<typeof upsertUserDevice>[0]["db"],
      input: {
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: "public-key",
      },
      userId: "user-a",
    });

    expect(result.publicKey).toBe("public-key");
    expect("privateKey" in result).toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      data: { epochRotationRequired: true },
      where: { groupMembers: { some: { userId: "user-a" } } },
    });
  });

  test("updates an existing device for the same user without replacing key material", async () => {
    const update = mock(async ({ data }: { data: Record<string, unknown> }) => ({
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      id: "device-a",
      lastSeenAt: data.lastSeenAt as Date,
      publicKey: "public-key",
      publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
      revokedAt: null,
      userId: "user-a",
    }));

    const result = await upsertUserDevice({
      db: {
        userDevice: {
          findUnique: async () => ({
            publicKey: "public-key",
            publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
            userId: "user-a",
          }),
          update,
        },
      },
      input: {
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: "public-key",
      },
      userId: "user-a",
    });

    expect(update).toHaveBeenCalled();
    expect(update.mock.calls[0]?.[0]).toEqual({
      data: {
        lastSeenAt: expect.any(Date),
        revokedAt: null,
      },
      where: {
        id: "device-a",
      },
    });
    expect(result.publicKey).toBe("public-key");
  });

  test("treats same-user create races as an idempotent success", async () => {
    let findUniqueCallCount = 0;
    const create = mock(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        clientVersion: "test",
        code: "P2002",
        meta: {
          target: ["id"],
        },
      });
    });
    const update = mock(async ({ data }: { data: Record<string, unknown> }) => ({
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      id: "device-a",
      lastSeenAt: data.lastSeenAt as Date,
      publicKey: "public-key",
      publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
      revokedAt: null,
      userId: "user-a",
    }));
    const findUnique = mock(async () => {
      findUniqueCallCount += 1;

      if (findUniqueCallCount === 1) {
        return null;
      }

      return {
        publicKey: "public-key",
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        userId: "user-a",
      };
    });

    const result = await upsertUserDevice({
      db: {
        $transaction: async (run: (tx: object) => Promise<unknown>) =>
          run({ userDevice: { create } }),
        userDevice: {
          findUnique,
          update,
        },
      } as unknown as Parameters<typeof upsertUserDevice>[0]["db"],
      input: {
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: "public-key",
      },
      userId: "user-a",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      data: {
        lastSeenAt: expect.any(Date),
        revokedAt: null,
      },
      where: {
        id: "device-a",
      },
    });
    expect(result.userId).toBe("user-a");
  });

  test("rejects attempts to change the public key for an existing device", async () => {
    await expect(
      upsertUserDevice({
        db: {
          userDevice: {
            findUnique: async () => ({
              publicKey: "public-key",
              publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
              userId: "user-a",
            }),
          },
        },
        input: {
          algorithm: DEVICE_KEY_ALGORITHM,
          deviceId: "device-a",
          publicKey: "public-key-next",
        },
        userId: "user-a",
      }),
    ).rejects.toThrow("This device ID is already registered with different key material.");
  });

  test("rejects attempts to register another user's device", async () => {
    await expect(
      upsertUserDevice({
        db: {
          userDevice: {
            findUnique: async () => ({
              publicKey: "public-key",
              publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
              userId: "user-b",
            }),
          },
        },
        input: {
          algorithm: DEVICE_KEY_ALGORITHM,
          deviceId: "device-a",
          publicKey: "public-key",
        },
        userId: "user-a",
      }),
    ).rejects.toThrow("This device is already registered to another user.");
  });

  test("builds invite acceptance context with all post-accept devices", async () => {
    const devices = [
      {
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: "device-a",
        publicKey: "public-a",
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        revokedAt: null,
        userId: "user-a",
      },
      {
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: "device-b-revoked",
        publicKey: "public-b-revoked",
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        revokedAt: new Date("2026-03-26T13:00:00.000Z"),
        userId: "user-b",
      },
      {
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: "device-b",
        publicKey: "public-b",
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        revokedAt: null,
        userId: "user-b",
      },
    ];
    const findMany = mock(async ({ where }: { where: { revokedAt: Date | null } }) =>
      devices.filter((device) => device.revokedAt === where.revokedAt),
    );

    const findFirstInvite = mock(async () => ({
      groupId: "group-1",
    }));

    const findHistoryKeys = mock(async () => [
      { id: "history-a-1", publicKey: "history-public-a-1", userId: "user-a", version: 1 },
      { id: "history-a-2", publicKey: "history-public-a-2", userId: "user-a", version: 2 },
      { id: "history-b-1", publicKey: "history-public-b-1", userId: "user-b", version: 1 },
    ]);

    const result = await getInviteAcceptanceContext({
      db: {
        accountHistoryKey: {
          findMany: findHistoryKeys,
        },
        groupEpoch: {
          findFirst: async () => ({
            createdAt: new Date("2026-03-26T12:00:00.000Z"),
            createdByDeviceId: "device-a",
            epochNumber: 1,
            groupId: "group-1",
            id: "epoch-1",
          }),
        },
        groupMemberInvite: {
          findFirst: findFirstInvite,
        },
        userDevice: {
          findMany,
        },
      },
      inviteId: "invite-1",
      userId: "user-b",
    });

    expect(findFirstInvite).toHaveBeenCalledWith({
      select: {
        groupId: true,
      },
      where: {
        id: "invite-1",
        recipientId: "user-b",
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      orderBy: {
        id: "asc",
      },
      select: {
        createdAt: true,
        id: true,
        publicKey: true,
        publicKeyAlgorithm: true,
        revokedAt: true,
        userId: true,
      },
      where: {
        OR: [
          {
            user: {
              groupMembers: {
                some: {
                  groupId: "group-1",
                },
              },
            },
          },
          {
            userId: "user-b",
          },
        ],
        revokedAt: null,
      },
    });
    expect(result.latestEpoch?.epochNumber).toBe(1);
    expect(result.recipients.map((recipient) => recipient.deviceId)).toEqual([
      "device-a",
      "device-b",
    ]);
    expect(findHistoryKeys).toHaveBeenCalledWith({
      orderBy: [{ userId: "asc" }, { version: "asc" }],
      select: { id: true, publicKey: true, userId: true, version: true },
      where: {
        OR: [{ user: { groupMembers: { some: { groupId: "group-1" } } } }, { userId: "user-b" }],
      },
    });
    expect(result.historyRecipients).toEqual([
      {
        historyKeyId: "history-a-2",
        publicKey: "history-public-a-2",
        userId: "user-a",
        version: 2,
      },
      {
        historyKeyId: "history-b-1",
        publicKey: "history-public-b-1",
        userId: "user-b",
        version: 1,
      },
    ]);
  });

  test("persists the next epoch for the current device set", async () => {
    const create = mock(async () => ({}));
    const createMany = mock(async () => ({}));
    const findFirstMember = mock(async () => ({
      id: "member-a",
    }));
    const findFirstDevice = mock(async () => ({
      id: "device-a",
      publicKey: "public-a",
    }));
    const devices = [
      {
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: "device-a",
        publicKey: "public-a",
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        revokedAt: null,
        userId: "user-a",
      },
      {
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: "device-b",
        publicKey: "public-b",
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        revokedAt: null,
        userId: "user-b",
      },
      {
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: "device-c-revoked",
        publicKey: "public-c",
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        revokedAt: new Date("2026-03-26T13:00:00.000Z"),
        userId: "user-c",
      },
    ];
    const findMany = mock(async ({ where }: { where: { revokedAt: Date | null } }) =>
      devices.filter((device) => device.revokedAt === where.revokedAt),
    );
    const wrappedKeyCreatedAt = new Date("2026-03-26T12:00:00.000Z");

    await persistGroupEpoch({
      db: {
        group: { updateMany: async () => ({ count: 1 }) },
        groupEpoch: {
          create,
          findFirst: async () => ({
            epochNumber: 1,
          }),
        },
        groupEpochRecipientKey: {
          createMany,
        },
        groupMember: {
          findFirst: findFirstMember,
        },
        userDevice: {
          findFirst: findFirstDevice,
          findMany,
        },
      },
      epoch: {
        createdByDeviceId: "device-a",
        epochId: "epoch-2",
        epochNumber: 2,
        recipientKeys: [
          {
            algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
            createdAt: wrappedKeyCreatedAt,
            ephemeralPublicKey: ephemeralA,
            epochId: "epoch-2",
            recipientDeviceId: "device-a",
            senderPublicKey: "public-a",
            wrappedKey: "wrapped-a",
          },
          {
            algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
            createdAt: wrappedKeyCreatedAt,
            ephemeralPublicKey: ephemeralB,
            epochId: "epoch-2",
            recipientDeviceId: "device-b",
            senderPublicKey: "public-a",
            wrappedKey: "wrapped-b",
          },
        ],
      },
      groupId: "group-1",
      userId: "user-a",
    });

    expect(findFirstMember).toHaveBeenCalledWith({
      select: {
        id: true,
      },
      where: {
        groupId: "group-1",
        userId: "user-a",
      },
    });
    expect(findFirstDevice).toHaveBeenCalledWith({
      select: {
        id: true,
        publicKey: true,
      },
      where: {
        id: "device-a",
        revokedAt: null,
        userId: "user-a",
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      orderBy: {
        id: "asc",
      },
      select: {
        createdAt: true,
        id: true,
        publicKey: true,
        publicKeyAlgorithm: true,
        revokedAt: true,
        userId: true,
      },
      where: {
        revokedAt: null,
        user: {
          groupMembers: {
            some: {
              groupId: "group-1",
            },
          },
        },
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        createdByDeviceId: "device-a",
        senderPublicKey: "public-a",
        epochNumber: 2,
        groupId: "group-1",
        id: "epoch-2",
      },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
          createdAt: wrappedKeyCreatedAt,
          ephemeralPublicKey: ephemeralA,
          groupEpochId: "epoch-2",
          recipientDeviceId: "device-a",
          wrappedKey: "wrapped-a",
        },
        {
          algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
          createdAt: wrappedKeyCreatedAt,
          ephemeralPublicKey: ephemeralB,
          groupEpochId: "epoch-2",
          recipientDeviceId: "device-b",
          wrappedKey: "wrapped-b",
        },
      ],
    });
  });

  test("rejects mismatched recipient sets", async () => {
    await expect(
      persistGroupEpoch({
        db: {
          group: { updateMany: async () => ({ count: 1 }) },
          groupEpoch: {
            create: async () => ({}),
            findFirst: async () => ({
              epochNumber: 1,
            }),
          },
          groupEpochRecipientKey: {
            createMany: async () => ({}),
          },
          groupMember: {
            findFirst: async () => ({
              id: "member-a",
            }),
          },
          userDevice: {
            findFirst: async () => ({
              id: "device-a",
              publicKey: "public-a",
            }),
            findMany: async () => [
              {
                createdAt: new Date("2026-03-26T12:00:00.000Z"),
                id: "device-a",
                publicKey: "public-a",
                publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
                revokedAt: null,
                userId: "user-a",
              },
            ],
          },
        },
        epoch: {
          createdByDeviceId: "device-a",
          epochId: "epoch-2",
          epochNumber: 2,
          recipientKeys: [
            {
              algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
              createdAt: new Date("2026-03-26T12:00:00.000Z"),
              ephemeralPublicKey: ephemeralA,
              epochId: "epoch-2",
              recipientDeviceId: "device-a",
              senderPublicKey: "public-a",
              wrappedKey: "wrapped-a",
            },
            {
              algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
              createdAt: new Date("2026-03-26T12:00:00.000Z"),
              ephemeralPublicKey: ephemeralB,
              epochId: "epoch-2",
              recipientDeviceId: "device-b",
              senderPublicKey: "public-a",
              wrappedKey: "wrapped-b",
            },
          ],
        },
        groupId: "group-1",
        userId: "user-a",
      }),
    ).rejects.toThrow("Epoch recipient set does not match the active group devices.");
  });

  test("rejects wrapped keys sent by a key other than the active device's registered key", async () => {
    const create = mock(async () => ({}));

    await expect(
      persistGroupEpoch({
        db: {
          group: { updateMany: async () => ({ count: 1 }) },
          groupEpoch: {
            create,
            findFirst: async () => ({
              epochNumber: 1,
            }),
          },
          groupEpochRecipientKey: {
            createMany: async () => ({}),
          },
          groupMember: {
            findFirst: async () => ({
              id: "member-a",
            }),
          },
          userDevice: {
            findFirst: async () => ({
              id: "device-a",
              publicKey: "public-a",
            }),
            findMany: async () => [],
          },
        },
        epoch: {
          createdByDeviceId: "device-a",
          epochId: "epoch-2",
          epochNumber: 2,
          recipientKeys: [
            {
              algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
              createdAt: new Date("2026-03-26T12:00:00.000Z"),
              ephemeralPublicKey: ephemeralA,
              epochId: "epoch-2",
              recipientDeviceId: "device-a",
              senderPublicKey: "public-attacker",
              wrappedKey: "wrapped-a",
            },
          ],
        },
        groupId: "group-1",
        userId: "user-a",
      }),
    ).rejects.toThrow("Wrapped epoch keys must be created by the active device.");
    expect(create).not.toHaveBeenCalled();
  });
});
