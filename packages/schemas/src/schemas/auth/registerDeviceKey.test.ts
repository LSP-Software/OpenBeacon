import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  DEVICE_KEY_ALGORITHM,
  encodeBase64,
  unwrapEpochKey,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import {
  groupEpochBundleSchema,
  historyKeyVersionSchema,
  registerDeviceKeySchema,
  wrappedEpochKeySchema,
} from "./registerDeviceKey.ts";

describe("registerDeviceKeySchema", () => {
  test("accepts a valid X25519 public key and trims surrounding whitespace", () => {
    const deviceKeyPair = createDeviceKeyPair();
    const publicKey = ` ${deviceKeyPair.publicKey} `;

    expect(
      registerDeviceKeySchema.parse({
        algorithm: deviceKeyPair.algorithm,
        deviceId: "device-a",
        publicKey,
      }),
    ).toEqual({
      algorithm: deviceKeyPair.algorithm,
      deviceId: "device-a",
      publicKey: publicKey.trim(),
    });
  });

  test("rejects malformed base64", () => {
    expect(() =>
      registerDeviceKeySchema.parse({
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: "not-base64!",
      }),
    ).toThrow("Invalid device public key.");
  });

  test("rejects decoded keys with the wrong length", () => {
    expect(() =>
      registerDeviceKeySchema.parse({
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: encodeBase64(new Uint8Array([1, 2, 3])),
      }),
    ).toThrow("Invalid device public key.");
  });

  test("rejects low-order device public keys", () => {
    for (const value of [0, 1]) {
      const bytes = new Uint8Array(32);
      bytes[0] = value;
      expect(
        registerDeviceKeySchema.safeParse({
          algorithm: DEVICE_KEY_ALGORITHM,
          deviceId: "device-a",
          publicKey: encodeBase64(bytes),
        }).success,
      ).toBe(false);
    }
  });

  test("rejects internal whitespace and oversized device keys", () => {
    const key = createDeviceKeyPair().publicKey;
    for (const publicKey of [
      `${key.slice(0, 4)}\n${key.slice(4)}`,
      `${key.slice(0, 4)}${" ".repeat(1_000_000)}${key.slice(4)}`,
    ]) {
      expect(
        registerDeviceKeySchema.safeParse({
          algorithm: DEVICE_KEY_ALGORITHM,
          deviceId: "device-a",
          publicKey,
        }).success,
      ).toBe(false);
    }
  });

  test("limits device identifiers", () => {
    const input = { algorithm: DEVICE_KEY_ALGORITHM, publicKey: createDeviceKeyPair().publicKey };
    expect(registerDeviceKeySchema.safeParse({ ...input, deviceId: "d".repeat(128) }).success).toBe(
      true,
    );
    expect(registerDeviceKeySchema.safeParse({ ...input, deviceId: "d".repeat(129) }).success).toBe(
      false,
    );
  });

  test("keeps a plain device model and drops one that could carry a link or run on", () => {
    const modelOf = (model: string) =>
      registerDeviceKeySchema.parse({
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: createDeviceKeyPair().publicKey,
        model,
      }).model;

    expect(modelOf("  Pixel 8 Pro (GC3VE)  ")).toBe("Pixel 8 Pro (GC3VE)");
    expect(modelOf("Pixel. Secure it at evil.com")).toBeUndefined();
    expect(modelOf("P".repeat(41))).toBeUndefined();
  });
});

describe("groupEpochBundleSchema", () => {
  test("validates encoded wrapped key components", () => {
    const device = createDeviceKeyPair();
    const epoch = createInitialGroupEpoch({
      creator: { deviceId: "device-a", privateKey: device.privateKey },
      groupId: "group-a",
      recipients: [
        {
          algorithm: DEVICE_KEY_ALGORITHM,
          createdAt: new Date(),
          deviceId: "device-a",
          publicKey: device.publicKey,
          revokedAt: null,
          userId: "user-a",
        },
      ],
    });
    const recipientKey = epoch.wrappedKeys[0]!;
    expect(wrappedEpochKeySchema.safeParse(recipientKey).success).toBe(true);
    expect(
      unwrapEpochKey({
        recipientDeviceId: "device-a",
        recipientPrivateKey: device.privateKey,
        wrappedEpochKey: wrappedEpochKeySchema.parse(recipientKey),
      }).expose(),
    ).toEqual(epoch.epochKey.expose());
    for (const field of ["ephemeralPublicKey", "senderPublicKey", "wrappedKey"] as const) {
      expect(
        wrappedEpochKeySchema.safeParse({ ...recipientKey, [field]: "invalid!" }).success,
      ).toBe(false);
      expect(
        wrappedEpochKeySchema.safeParse({
          ...recipientKey,
          [field]: encodeBase64(new Uint8Array(1)),
        }).success,
      ).toBe(false);
    }
  });

  test("rejects recipient keys whose epochId does not match the bundle epochId", () => {
    const recipientKey = wrappedEpochKeySchema.parse({
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      createdAt: new Date("2026-03-30T12:00:00.000Z"),
      ephemeralPublicKey: createDeviceKeyPair().publicKey,
      epochId: "epoch-2",
      recipientDeviceId: "device-b",
      senderPublicKey: createDeviceKeyPair().publicKey,
      wrappedKey: encodeBase64(new Uint8Array(48)),
    });

    const result = groupEpochBundleSchema.safeParse({
      createdByDeviceId: "device-a",
      epochId: "epoch-1",
      epochNumber: 1,
      historyKeys: [],
      recipientKeys: [recipientKey],
    });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["recipientKeys", 0, "epochId"],
      }),
    );
  });

  test("requires historyKeys on every bundle", () => {
    const recipientKey = wrappedEpochKeySchema.parse({
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      createdAt: new Date("2026-03-30T12:00:00.000Z"),
      ephemeralPublicKey: createDeviceKeyPair().publicKey,
      epochId: "epoch-1",
      recipientDeviceId: "device-a",
      senderPublicKey: createDeviceKeyPair().publicKey,
      wrappedKey: encodeBase64(new Uint8Array(48)),
    });
    const bundle = {
      createdByDeviceId: "device-a",
      epochId: "epoch-1",
      epochNumber: 1,
      recipientKeys: [recipientKey],
    };

    expect(groupEpochBundleSchema.safeParse(bundle).success).toBe(false);
    expect(groupEpochBundleSchema.safeParse({ ...bundle, historyKeys: [] }).success).toBe(true);
  });

  test("rejects oversized epoch identifiers in both the bundle and recipient key", () => {
    const recipientKey = {
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      createdAt: new Date(),
      ephemeralPublicKey: createDeviceKeyPair().publicKey,
      epochId: "e".repeat(129),
      recipientDeviceId: "device-a",
      senderPublicKey: createDeviceKeyPair().publicKey,
      wrappedKey: encodeBase64(new Uint8Array(48)),
    };
    expect(
      wrappedEpochKeySchema.safeParse({ ...recipientKey, epochId: "e".repeat(128) }).success,
    ).toBe(true);
    expect(wrappedEpochKeySchema.safeParse(recipientKey).success).toBe(false);
    expect(
      groupEpochBundleSchema.safeParse({
        createdByDeviceId: "device-a",
        epochId: recipientKey.epochId,
        epochNumber: 1,
        historyKeys: [],
        recipientKeys: [recipientKey],
      }).success,
    ).toBe(false);
  });

  test("caps epoch numbers and history key versions at the database integer limit", () => {
    expect(historyKeyVersionSchema.safeParse(2_147_483_647).success).toBe(true);
    expect(historyKeyVersionSchema.safeParse(2_147_483_648).success).toBe(false);
    const bundle = {
      createdByDeviceId: "device-a",
      epochId: "epoch-1",
      historyKeys: [],
      recipientKeys: [
        {
          algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
          createdAt: new Date(),
          ephemeralPublicKey: createDeviceKeyPair().publicKey,
          epochId: "epoch-1",
          recipientDeviceId: "device-a",
          senderPublicKey: createDeviceKeyPair().publicKey,
          wrappedKey: encodeBase64(new Uint8Array(48)),
        },
      ],
    };
    expect(
      groupEpochBundleSchema.safeParse({ ...bundle, epochNumber: 2_147_483_647 }).success,
    ).toBe(true);
    expect(
      groupEpochBundleSchema.safeParse({ ...bundle, epochNumber: 2_147_483_648 }).success,
    ).toBe(false);
  });

  test("limits how many keys one bundle can carry", () => {
    const recipientKey = {
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      createdAt: new Date(),
      ephemeralPublicKey: createDeviceKeyPair().publicKey,
      epochId: "epoch-1",
      recipientDeviceId: "device-a",
      senderPublicKey: createDeviceKeyPair().publicKey,
      wrappedKey: encodeBase64(new Uint8Array(48)),
    };
    const historyKey = {
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      ephemeralPublicKey: recipientKey.ephemeralPublicKey,
      epochId: "epoch-1",
      historyKeyVersion: 1,
      senderPublicKey: recipientKey.senderPublicKey,
      userId: "user-a",
      wrappedKey: recipientKey.wrappedKey,
    };
    const bundleWith = (recipients: number, histories: number) =>
      groupEpochBundleSchema.safeParse({
        createdByDeviceId: "device-a",
        epochId: "epoch-1",
        epochNumber: 1,
        historyKeys: Array.from({ length: histories }, () => historyKey),
        recipientKeys: Array.from({ length: recipients }, () => recipientKey),
      }).success;
    expect(bundleWith(5000, 1000)).toBe(true);
    expect(bundleWith(5001, 1)).toBe(false);
    expect(bundleWith(1, 1001)).toBe(false);
  });
});
