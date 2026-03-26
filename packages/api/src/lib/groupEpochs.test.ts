import { describe, expect, mock, test } from "bun:test";
import { DEVICE_KEY_ALGORITHM, WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { getInviteAcceptanceContext, persistGroupEpoch, upsertUserDevice } from "./groupEpochs.ts";

describe("group epoch helpers", () => {
  test("registers a device without persisting a private key", async () => {
    const upsert = mock(
      async ({
        create,
        update,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => ({
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: create.id as string,
        lastSeenAt: update.lastSeenAt as Date,
        name: create.name as null | string,
        publicKey: create.publicKey as string,
        publicKeyAlgorithm: create.publicKeyAlgorithm as string,
        revokedAt: null,
        userId: create.userId as string,
      }),
    );

    const result = await upsertUserDevice({
      db: {
        userDevice: {
          upsert,
        },
      },
      input: {
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        name: "Alice's phone",
        publicKey: "public-key",
      },
      userId: "user-a",
    });

    expect(result.publicKey).toBe("public-key");
    expect("privateKey" in result).toBe(false);
  });

  test("builds invite acceptance context with all post-accept devices", async () => {
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
          findMany: async () => [
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
          ],
        },
      },
      inviteId: "invite-1",
      userId: "user-b",
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
          findMany: async () => [
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
    });

    expect(create).toHaveBeenCalled();
    expect(createMany).toHaveBeenCalled();
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
