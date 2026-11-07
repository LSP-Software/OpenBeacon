import { describe, expect, test } from "bun:test";
import { createDeviceKeyPair, createInitialGroupEpoch } from "@openbeacon/encryption";
import { checkGroupKeyAccess } from "./groupKeyAccess.ts";

describe("group key access", () => {
  test("checks the current epoch even when the group has no location points", async () => {
    const keyPair = createDeviceKeyPair();
    const otherKeyPair = createDeviceKeyPair();
    const bundle = createInitialGroupEpoch({
      creator: { deviceId: "device", privateKey: keyPair.privateKey },
      groupId: "group",
      recipients: [
        {
          algorithm: keyPair.algorithm,
          createdAt: new Date(),
          deviceId: "device",
          publicKey: keyPair.publicKey,
          revokedAt: null,
          userId: "user",
        },
      ],
    });
    const input = {
      groupId: "group",
      ensureDeviceKeys: async () => ({ deviceId: "device", privateKey: keyPair.privateKey }),
      getLatestEpoch: async () => ({ epochId: bundle.epoch.epochId }),
      getWrappedKey: async () => bundle.wrappedKeys[0] ?? null,
    };

    expect(await checkGroupKeyAccess(input)).toBe("available");
    expect(await checkGroupKeyAccess({ ...input, getWrappedKey: async () => null })).toBe(
      "missing",
    );
    expect(
      await checkGroupKeyAccess({
        ...input,
        ensureDeviceKeys: async () => ({ deviceId: "device", privateKey: otherKeyPair.privateKey }),
      }),
    ).toBe("missing");
    expect(await checkGroupKeyAccess({ ...input, getLatestEpoch: async () => null })).toBe(
      "unavailable",
    );
    await expect(
      checkGroupKeyAccess({
        ...input,
        getWrappedKey: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
  });
});
