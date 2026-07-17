import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  DEVICE_KEY_ALGORITHM,
  encodeTrackingPointV1,
  encryptGroupPayload,
  TRACKING_POINT_KIND,
} from "@openbeacon/encryption";
import { createMapTrackingDecryptPoint } from "./mapTrackingDecrypt.ts";

const createRecipient = (deviceId: string, userId: string) => {
  const keyPair = createDeviceKeyPair();
  return {
    keyPair,
    recipient: {
      algorithm: DEVICE_KEY_ALGORITHM,
      createdAt: new Date(0),
      deviceId,
      publicKey: keyPair.publicKey,
      revokedAt: null,
      userId,
    },
  };
};

describe("createMapTrackingDecryptPoint", () => {
  test("decrypts a tracking point using a fetched epoch key", async () => {
    const { keyPair, recipient } = createRecipient("device-1", "user-1");
    const { epoch, epochKey, wrappedKeys } = createInitialGroupEpoch({
      createdByDeviceId: recipient.deviceId,
      groupId: "group-1",
      recipients: [recipient],
    });
    const encrypted = encryptGroupPayload({
      epochId: epoch.epochId,
      epochKey,
      groupId: "group-1",
      kind: TRACKING_POINT_KIND,
      payload: encodeTrackingPointV1({
        battery: { charging: true, level: 42 },
        latitude: 51.5,
        longitude: -0.12,
        speed: 3.5,
        timestamp: "2026-07-17T12:00:00.000Z",
        v: 1,
      }),
      senderDeviceId: "device-sender",
    });
    const wrappedKeyFetches: string[] = [];
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async ({ epochId }) => {
        wrappedKeyFetches.push(epochId);
        return wrappedKeys[0] ?? null;
      },
    });

    const result = await decryptPoint({
      groupId: "group-1",
      point: {
        algorithm: encrypted.algorithm,
        ciphertext: encrypted.ciphertext,
        clientPointId: "client-1",
        createdAt: encrypted.createdAt,
        epochId: encrypted.epochId,
        id: "server-1",
        kind: encrypted.kind,
        nonce: encrypted.nonce,
        senderDeviceId: encrypted.senderDeviceId,
        senderUserId: "user-sender",
      },
    });

    expect(result).toEqual({
      status: "ok",
      entry: {
        battery: { charging: true, level: 42 },
        latitude: 51.5,
        longitude: -0.12,
        serverCreatedAt: encrypted.createdAt,
        serverId: "server-1",
        sourceGroupId: "group-1",
        speed: 3.5,
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-sender",
      },
    });
    expect(wrappedKeyFetches).toEqual([epoch.epochId]);

    await decryptPoint({
      groupId: "group-1",
      point: {
        algorithm: encrypted.algorithm,
        ciphertext: encrypted.ciphertext,
        clientPointId: "client-2",
        createdAt: encrypted.createdAt,
        epochId: encrypted.epochId,
        id: "server-2",
        kind: encrypted.kind,
        nonce: encrypted.nonce,
        senderDeviceId: encrypted.senderDeviceId,
        senderUserId: "user-sender",
      },
    });
    expect(wrappedKeyFetches).toEqual([epoch.epochId]);
  });

  test("returns undecryptable when the wrapped epoch key is missing", async () => {
    const { keyPair, recipient } = createRecipient("device-1", "user-1");
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => null,
    });

    await expect(
      decryptPoint({
        groupId: "group-1",
        point: {
          algorithm: "XChaCha20-Poly1305",
          ciphertext: "cipher",
          clientPointId: "client-1",
          createdAt: new Date("2026-07-17T12:00:00.000Z"),
          epochId: "epoch-missing",
          id: "server-1",
          kind: TRACKING_POINT_KIND,
          nonce: "nonce",
          senderDeviceId: "device-sender",
          senderUserId: "user-sender",
        },
      }),
    ).resolves.toEqual({ status: "undecryptable" });
  });

  test("ignores non-trackingPoint kinds", async () => {
    const { keyPair, recipient } = createRecipient("device-1", "user-1");
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => {
        throw new Error("should not fetch");
      },
    });

    await expect(
      decryptPoint({
        groupId: "group-1",
        point: {
          algorithm: "XChaCha20-Poly1305",
          ciphertext: "cipher",
          clientPointId: "client-1",
          createdAt: new Date("2026-07-17T12:00:00.000Z"),
          epochId: "epoch-1",
          id: "server-1",
          kind: "other",
          nonce: "nonce",
          senderDeviceId: "device-sender",
          senderUserId: "user-sender",
        },
      }),
    ).resolves.toEqual({ status: "ignored" });
  });
});
