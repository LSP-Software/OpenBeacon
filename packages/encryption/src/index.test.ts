import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  decodeBase64,
  decodeJsonPayload,
  decryptGroupPayload,
  DevicePrivateKeyMaterial,
  encodeBase64,
  encryptGroupPayload,
  isUsableX25519PublicKey,
  serializeRecipientPublicKeyMaterial,
  unwrapEpochKey,
} from "./index.ts";
import { openAuth } from "./hpke.ts";

test("rejects low-order and invalid X25519 public keys", () => {
  const zero = new Uint8Array(32);
  const one = new Uint8Array(32);
  one[0] = 1;
  const highBitZero = new Uint8Array(32);
  highBitZero[31] = 128;
  const fieldValues = [0xec, 0xed, 0xee].map((first) => {
    const bytes = new Uint8Array(32).fill(255);
    bytes[0] = first;
    bytes[31] = 127;
    return bytes;
  });
  for (const publicKey of [zero, one, highBitZero, ...fieldValues, new Uint8Array(31)]) {
    expect(isUsableX25519PublicKey(publicKey)).toBe(false);
  }
  expect(isUsableX25519PublicKey(decodeBase64(createDeviceKeyPair().publicKey))).toBe(true);
});

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
      creator: { deviceId: recipient.deviceId, privateKey: keyPair.privateKey },
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
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
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
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
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
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
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
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
      groupId: "group-1",
      recipients: [alice.recipient, bob.recipient],
    });
    const nextEpoch = createNextGroupEpoch({
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
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
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
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
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
      groupId: "group-1",
      recipients: [alice.recipient, bob.recipient],
    });
    const nextEpoch = createNextGroupEpoch({
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
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
      creator: { deviceId: recipient.deviceId, privateKey: keyPair.privateKey },
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
      creator: { deviceId: recipient.deviceId, privateKey: keyPair.privateKey },
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
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
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

  test("records the creator's public key on each wrapped key", () => {
    const alice = createRecipient("device-a", "user-a");
    const bob = createRecipient("device-b", "user-b");
    const { wrappedKeys } = createInitialGroupEpoch({
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
      groupId: "group-1",
      recipients: [alice.recipient, bob.recipient],
    });

    expect(wrappedKeys.map((wrappedKey) => wrappedKey.senderPublicKey)).toEqual([
      alice.keyPair.publicKey,
      alice.keyPair.publicKey,
    ]);
  });

  test("rejects wrapped keys that were not created by the claimed creator", () => {
    const alice = createRecipient("device-a", "user-a");
    const bob = createRecipient("device-b", "user-b");
    const mallory = createRecipient("device-m", "user-m");
    const forged = createInitialGroupEpoch({
      creator: { deviceId: mallory.recipient.deviceId, privateKey: mallory.keyPair.privateKey },
      groupId: "group-1",
      recipients: [bob.recipient],
    });

    expect(() =>
      unwrapEpochKey({
        recipientDeviceId: bob.recipient.deviceId,
        recipientPrivateKey: bob.keyPair.privateKey,
        wrappedEpochKey: { ...forged.wrappedKeys[0], senderPublicKey: alice.keyPair.publicKey },
      }),
    ).toThrow();
  });

  test("rejects wrapped keys moved to another epoch or recipient", () => {
    const alice = createRecipient("device-a", "user-a");
    const { wrappedKeys } = createInitialGroupEpoch({
      creator: { deviceId: alice.recipient.deviceId, privateKey: alice.keyPair.privateKey },
      groupId: "group-1",
      recipients: [alice.recipient],
    });
    const unwrap = (wrappedEpochKey: (typeof wrappedKeys)[number]) =>
      unwrapEpochKey({
        recipientDeviceId: wrappedEpochKey.recipientDeviceId,
        recipientPrivateKey: alice.keyPair.privateKey,
        wrappedEpochKey,
      });

    expect(() => unwrap({ ...wrappedKeys[0], epochId: "epoch_other" })).toThrow();
    expect(() => unwrap({ ...wrappedKeys[0], recipientDeviceId: "device-other" })).toThrow();
  });
});

describe("frozen Device wrap", () => {
  const wrappedEpochKey = {
    algorithm: "HPKE-Auth-X25519-HKDF-SHA256-ChaCha20Poly1305",
    createdAt: new Date("2026-11-13T12:12:56.294Z"),
    ephemeralPublicKey: "dsdByCJCxBTBMaCUR7AvI8u1EDwJ7VL4NduOKRJ2wSM=",
    epochId: "epoch_vector_1",
    recipientDeviceId: "device_vector_recipient",
    senderPublicKey: "eaYx7t4b+cmPEgMs3q3Q56B5OY/HhriMyEbsia+FpRo=",
    wrappedKey: "t/2zRSWe70+3Low68aNZDnxGSZ8nCCUVKPSB2eQ2gMHROuF5L+mBEmL8QJECxS00",
  } as const;
  const recipientPrivateKey = decodeBase64("gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=");
  const epochKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

  test("a stored Device wrap still opens", () => {
    const opened = unwrapEpochKey({
      recipientDeviceId: "device_vector_recipient",
      recipientPrivateKey: new DevicePrivateKeyMaterial(recipientPrivateKey),
      wrappedEpochKey,
    });

    expect(encodeBase64(opened.expose())).toBe(epochKey);
  });

  test("the wrap info is these exact bytes", () => {
    const opened = openAuth({
      aad: new Uint8Array(),
      ciphertext: decodeBase64(wrappedEpochKey.wrappedKey),
      enc: decodeBase64(wrappedEpochKey.ephemeralPublicKey),
      info: new TextEncoder().encode(
        '{"context":"openbeacon.group-epoch.v1","epochId":"epoch_vector_1","purpose":"epoch-key-wrap","recipientDeviceId":"device_vector_recipient"}',
      ),
      recipientPrivateKey,
      senderPublicKey: decodeBase64(wrappedEpochKey.senderPublicKey),
    });

    expect(encodeBase64(opened)).toBe(epochKey);
  });
});
