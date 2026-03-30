import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  decodeBase64,
  decodeJsonPayload,
  decryptGroupPayload,
  encodeBase64,
  encryptGroupPayload,
  serializeRecipientPublicKeyMaterial,
  unwrapEpochKey,
} from "./index.ts";

const createRecipient = (deviceId: string, userId: string) => {
  const keyPair = createDeviceKeyPair();

  return {
    keyPair,
    recipient: serializeRecipientPublicKeyMaterial({
      algorithm: keyPair.algorithm,
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      deviceId,
      publicKey: keyPair.publicKey,
      revokedAt: null,
      userId,
    }),
  };
};

const getWrappedKeyForDevice = (
  wrappedKeys: ReturnType<typeof createInitialGroupEpoch>["wrappedKeys"],
  deviceId: string,
) => {
  const wrappedKey = wrappedKeys.find((key) => key.recipientDeviceId === deviceId);

  if (!wrappedKey) {
    throw new Error(`Missing wrapped key for ${deviceId}.`);
  }

  return wrappedKey;
};

describe("group epoch encryption", () => {
  test("round-trips base64-encoded bytes", () => {
    const cases = [
      new Uint8Array([]),
      new Uint8Array([7]),
      new Uint8Array([7, 8]),
      new Uint8Array([1, 2, 3, 4, 5]),
    ];

    for (const bytes of cases) {
      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    }
  });

  test("rejects impossible base64 lengths", () => {
    expect(() => decodeBase64("A")).toThrow("Invalid base64 value.");
  });

  test("rejects interior base64 padding", () => {
    expect(() => decodeBase64("AA=A")).toThrow("Invalid base64 value.");
  });

  test("rejects over-padded base64 values", () => {
    expect(() => decodeBase64("AAAA===")).toThrow("Invalid base64 value.");
  });

  test("encrypts and decrypts a payload", () => {
    const { keyPair, recipient } = createRecipient("device-a", "user-a");
    const { epoch, wrappedKeys } = createInitialGroupEpoch({
      createdByDeviceId: recipient.deviceId,
      groupId: "group-1",
      recipients: [recipient],
    });
    const epochKey = unwrapEpochKey({
      recipientDeviceId: recipient.deviceId,
      recipientPrivateKey: keyPair.privateKey,
      wrappedEpochKey: wrappedKeys[0],
    });
    const encryptedPayload = encryptGroupPayload({
      epochId: epoch.epochId,
      epochKey,
      groupId: epoch.groupId,
      kind: "location",
      payload: { latitude: 1, longitude: 2 },
      senderDeviceId: recipient.deviceId,
    });

    const decryptedPayload = decryptGroupPayload({
      encryptedPayload,
      epochKey,
      expectedMetadata: {
        epochId: epoch.epochId,
        groupId: epoch.groupId,
        kind: "location",
        senderDeviceId: recipient.deviceId,
      },
    });

    expect(
      decodeJsonPayload<{ latitude: number; longitude: number }>(decryptedPayload.bytes),
    ).toEqual({
      latitude: 1,
      longitude: 2,
    });
  });

  test("wraps the same epoch for multiple recipients", () => {
    const alice = createRecipient("device-a", "user-a");
    const bob = createRecipient("device-b", "user-b");
    const { wrappedKeys } = createInitialGroupEpoch({
      createdByDeviceId: alice.recipient.deviceId,
      groupId: "group-1",
      recipients: [alice.recipient, bob.recipient],
    });

    expect(wrappedKeys).toHaveLength(2);

    const aliceKey = unwrapEpochKey({
      recipientDeviceId: alice.recipient.deviceId,
      recipientPrivateKey: alice.keyPair.privateKey,
      wrappedEpochKey: getWrappedKeyForDevice(wrappedKeys, alice.recipient.deviceId),
    });
    const bobKey = unwrapEpochKey({
      recipientDeviceId: bob.recipient.deviceId,
      recipientPrivateKey: bob.keyPair.privateKey,
      wrappedEpochKey: getWrappedKeyForDevice(wrappedKeys, bob.recipient.deviceId),
    });

    expect(aliceKey.expose()).toEqual(bobKey.expose());
  });

  test("rotates epochs after a member is added and preserves old ciphertext", () => {
    const alice = createRecipient("device-a", "user-a");
    const bob = createRecipient("device-b", "user-b");
    const charlie = createRecipient("device-c", "user-c");
    const initialEpoch = createInitialGroupEpoch({
      createdByDeviceId: alice.recipient.deviceId,
      groupId: "group-1",
      recipients: [alice.recipient, bob.recipient],
    });
    const oldEpochKey = unwrapEpochKey({
      recipientDeviceId: alice.recipient.deviceId,
      recipientPrivateKey: alice.keyPair.privateKey,
      wrappedEpochKey: getWrappedKeyForDevice(initialEpoch.wrappedKeys, alice.recipient.deviceId),
    });
    const encryptedPayload = encryptGroupPayload({
      epochId: initialEpoch.epoch.epochId,
      epochKey: oldEpochKey,
      groupId: "group-1",
      kind: "place",
      payload: { name: "Home" },
      senderDeviceId: alice.recipient.deviceId,
    });
    const nextEpoch = createNextGroupEpoch({
      createdByDeviceId: alice.recipient.deviceId,
      previousEpoch: initialEpoch.epoch,
      recipients: [alice.recipient, bob.recipient, charlie.recipient],
    });

    expect(nextEpoch.epoch.epochNumber).toBe(2);

    const decryptedOldPayload = decryptGroupPayload({
      encryptedPayload,
      epochKey: oldEpochKey,
      expectedMetadata: {
        epochId: initialEpoch.epoch.epochId,
        groupId: initialEpoch.epoch.groupId,
        kind: "place",
        senderDeviceId: alice.recipient.deviceId,
      },
    });

    expect(decodeJsonPayload<{ name: string }>(decryptedOldPayload.bytes)).toEqual({
      name: "Home",
    });
    expect(
      nextEpoch.wrappedKeys.some(
        (wrappedKey) => wrappedKey.recipientDeviceId === charlie.recipient.deviceId,
      ),
    ).toBe(true);
  });

  test("rotates epochs after a member is removed", () => {
    const alice = createRecipient("device-a", "user-a");
    const bob = createRecipient("device-b", "user-b");
    const initialEpoch = createInitialGroupEpoch({
      createdByDeviceId: alice.recipient.deviceId,
      groupId: "group-1",
      recipients: [alice.recipient, bob.recipient],
    });
    const nextEpoch = createNextGroupEpoch({
      createdByDeviceId: alice.recipient.deviceId,
      previousEpoch: initialEpoch.epoch,
      recipients: [alice.recipient],
    });

    expect(nextEpoch.wrappedKeys.map((wrappedKey) => wrappedKey.recipientDeviceId)).toEqual([
      alice.recipient.deviceId,
    ]);
  });

  test("new recipients cannot decrypt old epochs without an old wrapped key", () => {
    const alice = createRecipient("device-a", "user-a");
    const bob = createRecipient("device-b", "user-b");
    const charlie = createRecipient("device-c", "user-c");
    const initialEpoch = createInitialGroupEpoch({
      createdByDeviceId: alice.recipient.deviceId,
      groupId: "group-1",
      recipients: [alice.recipient, bob.recipient],
    });

    expect(
      initialEpoch.wrappedKeys.some(
        (wrappedKey) => wrappedKey.recipientDeviceId === charlie.recipient.deviceId,
      ),
    ).toBe(false);
  });

  test("removed recipients cannot decrypt the next epoch", () => {
    const alice = createRecipient("device-a", "user-a");
    const bob = createRecipient("device-b", "user-b");
    const initialEpoch = createInitialGroupEpoch({
      createdByDeviceId: alice.recipient.deviceId,
      groupId: "group-1",
      recipients: [alice.recipient, bob.recipient],
    });
    const nextEpoch = createNextGroupEpoch({
      createdByDeviceId: alice.recipient.deviceId,
      previousEpoch: initialEpoch.epoch,
      recipients: [alice.recipient],
    });

    expect(
      nextEpoch.wrappedKeys.some(
        (wrappedKey) => wrappedKey.recipientDeviceId === bob.recipient.deviceId,
      ),
    ).toBe(false);
  });

  test("rejects tampered ciphertext", () => {
    const { keyPair, recipient } = createRecipient("device-a", "user-a");
    const { epoch, wrappedKeys } = createInitialGroupEpoch({
      createdByDeviceId: recipient.deviceId,
      groupId: "group-1",
      recipients: [recipient],
    });
    const epochKey = unwrapEpochKey({
      recipientDeviceId: recipient.deviceId,
      recipientPrivateKey: keyPair.privateKey,
      wrappedEpochKey: wrappedKeys[0],
    });
    const encryptedPayload = encryptGroupPayload({
      epochId: epoch.epochId,
      epochKey,
      groupId: epoch.groupId,
      kind: "location",
      payload: { latitude: 1, longitude: 2 },
      senderDeviceId: recipient.deviceId,
    });

    expect(() =>
      decryptGroupPayload({
        encryptedPayload: {
          ...encryptedPayload,
          ciphertext: `${encryptedPayload.ciphertext.slice(0, -4)}AAAA`,
        },
        epochKey,
        expectedMetadata: {
          epochId: epoch.epochId,
          groupId: epoch.groupId,
          kind: "location",
          senderDeviceId: recipient.deviceId,
        },
      }),
    ).toThrow();
  });

  test("rejects metadata mismatches", () => {
    const { keyPair, recipient } = createRecipient("device-a", "user-a");
    const { epoch, wrappedKeys } = createInitialGroupEpoch({
      createdByDeviceId: recipient.deviceId,
      groupId: "group-1",
      recipients: [recipient],
    });
    const epochKey = unwrapEpochKey({
      recipientDeviceId: recipient.deviceId,
      recipientPrivateKey: keyPair.privateKey,
      wrappedEpochKey: wrappedKeys[0],
    });
    const encryptedPayload = encryptGroupPayload({
      epochId: epoch.epochId,
      epochKey,
      groupId: epoch.groupId,
      kind: "location",
      payload: { latitude: 1, longitude: 2 },
      senderDeviceId: recipient.deviceId,
    });

    expect(() =>
      decryptGroupPayload({
        encryptedPayload,
        epochKey,
        expectedMetadata: {
          epochId: epoch.epochId,
          groupId: "group-2",
          kind: "location",
          senderDeviceId: recipient.deviceId,
        },
      }),
    ).toThrow("Encrypted payload metadata mismatch.");
  });

  test("rejects wrong private keys while unwrapping", () => {
    const alice = createRecipient("device-a", "user-a");
    const bob = createRecipient("device-b", "user-b");
    const { wrappedKeys } = createInitialGroupEpoch({
      createdByDeviceId: alice.recipient.deviceId,
      groupId: "group-1",
      recipients: [alice.recipient],
    });

    expect(() =>
      unwrapEpochKey({
        recipientDeviceId: alice.recipient.deviceId,
        recipientPrivateKey: bob.keyPair.privateKey,
        wrappedEpochKey: wrappedKeys[0],
      }),
    ).toThrow();
  });

  test("redacts sensitive wrappers when serialized", () => {
    const deviceKeyPair = createDeviceKeyPair();
    const { epochKey } = createInitialGroupEpoch({
      createdByDeviceId: "device-a",
      groupId: "group-1",
      recipients: [
        serializeRecipientPublicKeyMaterial({
          algorithm: deviceKeyPair.algorithm,
          createdAt: new Date("2026-03-26T12:00:00.000Z"),
          deviceId: "device-a",
          publicKey: deviceKeyPair.publicKey,
          revokedAt: null,
          userId: "user-a",
        }),
      ],
    });

    expect(JSON.stringify({ epochKey, privateKey: deviceKeyPair.privateKey })).toContain(
      "REDACTED",
    );
  });
});
