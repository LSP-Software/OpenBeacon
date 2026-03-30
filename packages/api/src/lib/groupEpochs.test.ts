import { describe, expect, mock, test } from "bun:test";
import { DEVICE_KEY_ALGORITHM, WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { getInviteAcceptanceContext, persistGroupEpoch, upsertUserDevice } from "./groupEpochs.ts";

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

    const result = await upsertUserDevice({
      db: {
        userDevice: {
          create,
          findUnique: async () => null,
        },
      },
      input: {
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: "public-key",
      },
      userId: "user-a",
    });

    expect(result.publicKey).toBe("public-key");
    expect("privateKey" in result).toBe(false);
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
      throw new Error("Unique constraint failed");
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
        userDevice: {
          create,
          findUnique,
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
    await expect(() =>
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
    ).toThrow("This device ID is already registered with different key material.");
  });

  test("rejects attempts to register another user's device", async () => {
    await expect(() =>
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
    ).toThrow("This device is already registered to another user.");
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

    const result = await getInviteAcceptanceContext({
      db: {
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
          findFirst: async () => ({
            groupId: "group-1",
          }),
        },
        userDevice: {
          findMany,
        },
      },
      inviteId: "invite-1",
      userId: "user-b",
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
  });

  test("persists the next epoch for the current device set", async () => {
    const create = mock(async () => ({}));
    const createMany = mock(async () => ({}));
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
          findFirst: async () => ({
            id: "member-a",
          }),
        },
        userDevice: {
          findFirst: async () => ({
            id: "device-a",
          }),
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
            ephemeralPublicKey: "ephemeral-a",
            epochId: "epoch-2",
            nonce: "nonce-a",
            recipientDeviceId: "device-a",
            wrappedKey: "wrapped-a",
          },
          {
            algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
            createdAt: wrappedKeyCreatedAt,
            ephemeralPublicKey: "ephemeral-b",
            epochId: "epoch-2",
            nonce: "nonce-b",
            recipientDeviceId: "device-b",
            wrappedKey: "wrapped-b",
          },
        ],
      },
      groupId: "group-1",
      userId: "user-a",
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
          ephemeralPublicKey: "ephemeral-a",
          groupEpochId: "epoch-2",
          nonce: "nonce-a",
          recipientDeviceId: "device-a",
          wrappedKey: "wrapped-a",
        },
        {
          algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
          createdAt: wrappedKeyCreatedAt,
          ephemeralPublicKey: "ephemeral-b",
          groupEpochId: "epoch-2",
          nonce: "nonce-b",
          recipientDeviceId: "device-b",
          wrappedKey: "wrapped-b",
        },
      ],
    });
  });

  test("rejects mismatched recipient sets", async () => {
    await expect(() =>
      persistGroupEpoch({
        db: {
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
              ephemeralPublicKey: "ephemeral-a",
              epochId: "epoch-2",
              nonce: "nonce-a",
              recipientDeviceId: "device-a",
              wrappedKey: "wrapped-a",
            },
            {
              algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
              createdAt: new Date("2026-03-26T12:00:00.000Z"),
              ephemeralPublicKey: "ephemeral-b",
              epochId: "epoch-2",
              nonce: "nonce-b",
              recipientDeviceId: "device-b",
              wrappedKey: "wrapped-b",
            },
          ],
        },
        groupId: "group-1",
        userId: "user-a",
      }),
    ).toThrow("Epoch recipient set does not match the active group devices.");
  });
});
