import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  DEVICE_KEY_ALGORITHM,
  encodeTrackingPointV1,
  encryptGroupPayload,
  TRACKING_POINT_KIND,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import { createMapTrackingDecryptPoint, MISSING_EPOCH_KEY_RETRY_MS } from "./mapTrackingDecrypt.ts";

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

const undecryptablePoint = ({ epochId, id }: { epochId: string; id: string }) => ({
  algorithm: "XChaCha20-Poly1305" as const,
  ciphertext: "cipher",
  clientPointId: `client-${id}`,
  createdAt: new Date("2026-07-17T12:00:00.000Z"),
  epochId,
  id,
  kind: TRACKING_POINT_KIND,
  nonce: "nonce",
  senderDeviceId: "device-sender",
  senderUserId: "user-sender",
});

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
        point: undecryptablePoint({ epochId: "epoch-missing", id: "server-1" }),
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

  test("treats malformed wrapped keys as undecryptable", async () => {
    const { keyPair, recipient } = createRecipient("device-1", "user-1");
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => ({
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
        createdAt: new Date(0),
        ephemeralPublicKey: "not-a-valid-key",
        epochId: "epoch-1",
        nonce: "nonce",
        recipientDeviceId: recipient.deviceId,
        wrappedKey: "not-a-valid-wrapped-key",
      }),
    });

    await expect(
      decryptPoint({
        groupId: "group-1",
        point: undecryptablePoint({ epochId: "epoch-1", id: "server-1" }),
      }),
    ).resolves.toEqual({ status: "undecryptable" });
  });

  test("keeps a cached epoch key when only the point payload is corrupt", async () => {
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
        battery: { charging: false, level: 10 },
        latitude: 1,
        longitude: 2,
        speed: null,
        timestamp: "2026-07-17T12:00:00.000Z",
        v: 1,
      }),
      senderDeviceId: "device-sender",
    });
    let wrappedKeyFetches = 0;
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => {
        wrappedKeyFetches += 1;
        return wrappedKeys[0] ?? null;
      },
    });

    await expect(
      decryptPoint({
        groupId: "group-1",
        point: {
          algorithm: encrypted.algorithm,
          ciphertext: "AAAA",
          clientPointId: "client-bad",
          createdAt: encrypted.createdAt,
          epochId: encrypted.epochId,
          id: "server-bad",
          kind: encrypted.kind,
          nonce: encrypted.nonce,
          senderDeviceId: encrypted.senderDeviceId,
          senderUserId: "user-sender",
        },
      }),
    ).resolves.toEqual({ status: "undecryptable" });

    const good = await decryptPoint({
      groupId: "group-1",
      point: {
        algorithm: encrypted.algorithm,
        ciphertext: encrypted.ciphertext,
        clientPointId: "client-good",
        createdAt: encrypted.createdAt,
        epochId: encrypted.epochId,
        id: "server-good",
        kind: encrypted.kind,
        nonce: encrypted.nonce,
        senderDeviceId: encrypted.senderDeviceId,
        senderUserId: "user-sender",
      },
    });

    expect(good.status).toBe("ok");
    expect(wrappedKeyFetches).toBe(1);
  });

  test("concurrent decrypts for the same group and epoch share one wrapped-key fetch", async () => {
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
    let wrappedKeyFetches = 0;
    let releaseFetch: (value: (typeof wrappedKeys)[0] | null) => void = () => {};
    const fetchGate = new Promise<(typeof wrappedKeys)[0] | null>((resolve) => {
      releaseFetch = resolve;
    });
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => {
        wrappedKeyFetches += 1;
        return fetchGate;
      },
    });

    const first = decryptPoint({
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
    const second = decryptPoint({
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

    await Promise.resolve();
    expect(wrappedKeyFetches).toBe(1);
    releaseFetch(wrappedKeys[0] ?? null);

    await expect(first).resolves.toMatchObject({ status: "ok" });
    await expect(second).resolves.toMatchObject({ status: "ok" });
    expect(wrappedKeyFetches).toBe(1);
  });

  test("a missing-key page fetches the wrapped key once and stays undecryptable", async () => {
    const { keyPair, recipient } = createRecipient("device-1", "user-1");
    let wrappedKeyFetches = 0;
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => {
        wrappedKeyFetches += 1;
        return null;
      },
    });

    const results = [];
    for (let index = 0; index < 100; index += 1) {
      results.push(
        await decryptPoint({
          groupId: "group-1",
          point: undecryptablePoint({ epochId: "epoch-missing", id: `server-${index}` }),
        }),
      );
    }

    expect(results.every((result) => result.status === "undecryptable")).toBe(true);
    expect(wrappedKeyFetches).toBe(1);
  });

  test("transient wrapped-key failures are not negative-cached and can retry", async () => {
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
    let wrappedKeyFetches = 0;
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => {
        wrappedKeyFetches += 1;
        if (wrappedKeyFetches === 1) {
          throw new Error("network down");
        }
        return wrappedKeys[0] ?? null;
      },
    });

    await expect(
      decryptPoint({
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
      }),
    ).rejects.toThrow("network down");

    const result = await decryptPoint({
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

    expect(result.status).toBe("ok");
    expect(wrappedKeyFetches).toBe(2);
  });

  test("discovers a later-provisioned key after the negative-cache window without remounting", async () => {
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
    let now = 0;
    let wrappedKeyFetches = 0;
    let available = false;
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => {
        wrappedKeyFetches += 1;
        return available ? (wrappedKeys[0] ?? null) : null;
      },
      now: () => now,
    });

    await expect(
      decryptPoint({
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
      }),
    ).resolves.toEqual({ status: "undecryptable" });
    expect(wrappedKeyFetches).toBe(1);

    available = true;
    now = MISSING_EPOCH_KEY_RETRY_MS - 1;
    await expect(
      decryptPoint({
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
      }),
    ).resolves.toEqual({ status: "undecryptable" });
    expect(wrappedKeyFetches).toBe(1);

    now = MISSING_EPOCH_KEY_RETRY_MS;
    const result = await decryptPoint({
      groupId: "group-1",
      point: {
        algorithm: encrypted.algorithm,
        ciphertext: encrypted.ciphertext,
        clientPointId: "client-3",
        createdAt: encrypted.createdAt,
        epochId: encrypted.epochId,
        id: "server-3",
        kind: encrypted.kind,
        nonce: encrypted.nonce,
        senderDeviceId: encrypted.senderDeviceId,
        senderUserId: "user-sender",
      },
    });
    expect(result.status).toBe("ok");
    expect(wrappedKeyFetches).toBe(2);
  });

  test("does not collide cache entries across group and epoch identifiers", async () => {
    const { keyPair, recipient } = createRecipient("device-1", "user-1");
    const first = createInitialGroupEpoch({
      createdByDeviceId: recipient.deviceId,
      groupId: "a:b",
      recipients: [recipient],
    });
    const firstEncrypted = encryptGroupPayload({
      epochId: first.epoch.epochId,
      epochKey: first.epochKey,
      groupId: "a:b",
      kind: TRACKING_POINT_KIND,
      payload: encodeTrackingPointV1({
        battery: { charging: false, level: 10 },
        latitude: 1,
        longitude: 2,
        speed: null,
        timestamp: "2026-07-17T12:00:00.000Z",
        v: 1,
      }),
      senderDeviceId: "device-sender",
    });

    const wrappedByRequest: Array<{ epochId: string; groupId: string }> = [];
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async ({ epochId, groupId }) => {
        wrappedByRequest.push({ epochId, groupId });
        if (groupId === "a:b") {
          return first.wrappedKeys[0] ?? null;
        }
        return null;
      },
    });

    const firstResult = await decryptPoint({
      groupId: "a:b",
      point: {
        algorithm: firstEncrypted.algorithm,
        ciphertext: firstEncrypted.ciphertext,
        clientPointId: "client-1",
        createdAt: firstEncrypted.createdAt,
        epochId: firstEncrypted.epochId,
        id: "server-1",
        kind: firstEncrypted.kind,
        nonce: firstEncrypted.nonce,
        senderDeviceId: firstEncrypted.senderDeviceId,
        senderUserId: "user-sender",
      },
    });
    expect(firstResult.status).toBe("ok");

    await expect(
      decryptPoint({
        groupId: "a",
        point: undecryptablePoint({ epochId: `b:${first.epoch.epochId}`, id: "server-2" }),
      }),
    ).resolves.toEqual({ status: "undecryptable" });

    expect(wrappedByRequest).toEqual([
      { epochId: first.epoch.epochId, groupId: "a:b" },
      { epochId: `b:${first.epoch.epochId}`, groupId: "a" },
    ]);
  });

  test("clear removes cached and missing keys so the next decrypt refetches", async () => {
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
    let wrappedKeyFetches = 0;
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => {
        wrappedKeyFetches += 1;
        return wrappedKeys[0] ?? null;
      },
    });

    await expect(
      decryptPoint({
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
      }),
    ).resolves.toMatchObject({ status: "ok" });
    expect(wrappedKeyFetches).toBe(1);

    decryptPoint.clear();

    await expect(
      decryptPoint({
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
      }),
    ).resolves.toMatchObject({ status: "ok" });
    expect(wrappedKeyFetches).toBe(2);
  });

  test("clearGroup only clears cache entries for that group", async () => {
    const { keyPair, recipient } = createRecipient("device-1", "user-1");
    const groupOne = createInitialGroupEpoch({
      createdByDeviceId: recipient.deviceId,
      groupId: "group-1",
      recipients: [recipient],
    });
    const groupTwo = createInitialGroupEpoch({
      createdByDeviceId: recipient.deviceId,
      groupId: "group-2",
      recipients: [recipient],
    });
    const encryptedOne = encryptGroupPayload({
      epochId: groupOne.epoch.epochId,
      epochKey: groupOne.epochKey,
      groupId: "group-1",
      kind: TRACKING_POINT_KIND,
      payload: encodeTrackingPointV1({
        battery: { charging: false, level: 10 },
        latitude: 1,
        longitude: 2,
        speed: null,
        timestamp: "2026-07-17T12:00:00.000Z",
        v: 1,
      }),
      senderDeviceId: "device-sender",
    });
    const encryptedTwo = encryptGroupPayload({
      epochId: groupTwo.epoch.epochId,
      epochKey: groupTwo.epochKey,
      groupId: "group-2",
      kind: TRACKING_POINT_KIND,
      payload: encodeTrackingPointV1({
        battery: { charging: true, level: 20 },
        latitude: 3,
        longitude: 4,
        speed: null,
        timestamp: "2026-07-17T12:01:00.000Z",
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
      getWrappedEpochKey: async ({ groupId }) => {
        wrappedKeyFetches.push(groupId);
        if (groupId === "group-1") {
          return groupOne.wrappedKeys[0] ?? null;
        }
        return groupTwo.wrappedKeys[0] ?? null;
      },
    });

    await decryptPoint({
      groupId: "group-1",
      point: {
        algorithm: encryptedOne.algorithm,
        ciphertext: encryptedOne.ciphertext,
        clientPointId: "client-1",
        createdAt: encryptedOne.createdAt,
        epochId: encryptedOne.epochId,
        id: "server-1",
        kind: encryptedOne.kind,
        nonce: encryptedOne.nonce,
        senderDeviceId: encryptedOne.senderDeviceId,
        senderUserId: "user-sender",
      },
    });
    await decryptPoint({
      groupId: "group-2",
      point: {
        algorithm: encryptedTwo.algorithm,
        ciphertext: encryptedTwo.ciphertext,
        clientPointId: "client-2",
        createdAt: encryptedTwo.createdAt,
        epochId: encryptedTwo.epochId,
        id: "server-2",
        kind: encryptedTwo.kind,
        nonce: encryptedTwo.nonce,
        senderDeviceId: encryptedTwo.senderDeviceId,
        senderUserId: "user-sender",
      },
    });
    expect(wrappedKeyFetches).toEqual(["group-1", "group-2"]);

    decryptPoint.clearGroup("group-1");

    await decryptPoint({
      groupId: "group-1",
      point: {
        algorithm: encryptedOne.algorithm,
        ciphertext: encryptedOne.ciphertext,
        clientPointId: "client-3",
        createdAt: encryptedOne.createdAt,
        epochId: encryptedOne.epochId,
        id: "server-3",
        kind: encryptedOne.kind,
        nonce: encryptedOne.nonce,
        senderDeviceId: encryptedOne.senderDeviceId,
        senderUserId: "user-sender",
      },
    });
    await decryptPoint({
      groupId: "group-2",
      point: {
        algorithm: encryptedTwo.algorithm,
        ciphertext: encryptedTwo.ciphertext,
        clientPointId: "client-4",
        createdAt: encryptedTwo.createdAt,
        epochId: encryptedTwo.epochId,
        id: "server-4",
        kind: encryptedTwo.kind,
        nonce: encryptedTwo.nonce,
        senderDeviceId: encryptedTwo.senderDeviceId,
        senderUserId: "user-sender",
      },
    });

    expect(wrappedKeyFetches).toEqual(["group-1", "group-2", "group-1"]);
  });

  test("clear during an in-flight fetch does not leave a cached epoch key", async () => {
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
    let wrappedKeyFetches = 0;
    let releaseFetch: (value: (typeof wrappedKeys)[0] | null) => void = () => {};
    const fetchGate = new Promise<(typeof wrappedKeys)[0] | null>((resolve) => {
      releaseFetch = resolve;
    });
    const decryptPoint = createMapTrackingDecryptPoint({
      ensureDeviceKeys: async () => ({
        deviceId: recipient.deviceId,
        privateKey: keyPair.privateKey,
      }),
      getWrappedEpochKey: async () => {
        wrappedKeyFetches += 1;
        return fetchGate;
      },
    });

    const pending = decryptPoint({
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

    await Promise.resolve();
    decryptPoint.clear();
    releaseFetch(wrappedKeys[0] ?? null);
    await expect(pending).resolves.toMatchObject({ status: "ok" });

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
    expect(wrappedKeyFetches).toBe(2);
  });
});
