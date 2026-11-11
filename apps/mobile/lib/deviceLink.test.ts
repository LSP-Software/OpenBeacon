import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createDeviceLinkSecret,
  createHistoryKeyPair,
  formatDeviceLinkCode,
  type HistoryPrivateKeyMaterial,
  sealDeviceLinkHandover,
} from "@openbeacon/encryption";

const linkId = "8d3c1f57-6f0e-4f43-9a51-6f41b8f0a2d1";
const approver = createDeviceKeyPair();
const newDevice = createDeviceKeyPair();
const historyKey = createHistoryKeyPair();
const psk = createDeviceLinkSecret();
let thisDevice = { ...approver, deviceId: "device-approver", userId: "user-1" };
let registeredPublicKey = newDevice.publicKey;
let publishedHistoryKeys = [{ publicKey: historyKey.publicKey, version: 1 }];
let heldKeys = new Map<number, HistoryPrivateKeyMaterial>();
let approved: { ciphertext: string; enc: string; linkId: string } | null = null;
const stored: { userId: string; version: number }[] = [];
const activeDevices: string[] = [];

mock.module("./api.ts", () => ({
  trpcClient: {
    accountRecovery: {
      status: {
        query: async () => ({
          currentHistoryKey: publishedHistoryKeys.at(-1) ?? null,
          historyKeys: publishedHistoryKeys,
        }),
      },
    },
    deviceLink: {
      approve: {
        mutate: async (input: { ciphertext: string; enc: string; linkId: string }) => {
          approved = input;
        },
      },
      get: {
        query: async () => ({
          deviceId: "device-new",
          icon: "phone",
          model: "Pixel 9",
          name: "Pixel 9",
          platform: "android",
          publicKey: registeredPublicKey,
        }),
      },
    },
  },
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => thisDevice,
}));

mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async ({ version }: { version: number }) => heldKeys.get(version) ?? null,
  storeHistoryKey: async ({ userId, version }: { userId: string; version: number }) => {
    stored.push({ userId, version });
  },
}));

mock.module("./createHistoryKey.ts", () => ({
  KEY_NOT_SAVED_MESSAGE: "This phone couldn't save the key.",
}));

mock.module("./deviceActivation.ts", () => ({
  markThisDeviceActive: (deviceId: string) => {
    activeDevices.push(deviceId);
  },
}));

const {
  APPROVER_MISSING_HISTORY_KEY_MESSAGE,
  approveDeviceLink,
  DEVICE_KEY_MISMATCH_MESSAGE,
  finishDeviceLink,
  HANDOVER_REJECTED_MESSAGE,
  lookUpDeviceLink,
  NOT_A_DEVICE_CODE_MESSAGE,
} = await import("./deviceLink.ts");

const code = formatDeviceLinkCode({ devicePublicKey: newDevice.publicKey, linkId, psk });

const approveAndSwitchToNewDevice = async () => {
  heldKeys = new Map([[1, historyKey.privateKey]]);
  await approveDeviceLink(await lookUpDeviceLink(code));
  if (!approved) throw new Error("Nothing was approved.");
  thisDevice = { ...newDevice, deviceId: "device-new", userId: "user-1" };
  return approved;
};

describe("device link on the phones", () => {
  beforeEach(() => {
    thisDevice = { ...approver, deviceId: "device-approver", userId: "user-1" };
    registeredPublicKey = newDevice.publicKey;
    publishedHistoryKeys = [{ publicKey: historyKey.publicKey, version: 1 }];
    heldKeys = new Map();
    approved = null;
    stored.length = 0;
    activeDevices.length = 0;
  });

  test("the new phone stores the handed-over History key and becomes active", async () => {
    const sealed = await approveAndSwitchToNewDevice();

    await finishDeviceLink({ ...sealed, approverPublicKey: approver.publicKey, psk });

    expect(Object.keys(sealed).sort()).toEqual(["ciphertext", "enc", "linkId"]);
    expect(stored).toEqual([{ userId: "user-1", version: 1 }]);
    expect(activeDevices).toEqual(["device-new"]);
  });

  test("the scanning phone refuses a code that isn't a device link", async () => {
    await expect(lookUpDeviceLink("https://example.com")).rejects.toThrow(
      NOT_A_DEVICE_CODE_MESSAGE,
    );
  });

  test("the scanning phone refuses when the server's key for the device isn't the QR code's key", async () => {
    registeredPublicKey = createDeviceKeyPair().publicKey;

    await expect(lookUpDeviceLink(code)).rejects.toThrow(DEVICE_KEY_MISMATCH_MESSAGE);
  });

  test("the scanning phone needs the current History key to approve", async () => {
    await expect(approveDeviceLink(await lookUpDeviceLink(code))).rejects.toThrow(
      APPROVER_MISSING_HISTORY_KEY_MESSAGE,
    );
    expect(approved).toBeNull();
  });

  test("the scanning phone refuses to share a stored key that doesn't match the published History key", async () => {
    const olderKey = createHistoryKeyPair();
    publishedHistoryKeys = [
      { publicKey: olderKey.publicKey, version: 1 },
      { publicKey: historyKey.publicKey, version: 2 },
    ];
    heldKeys = new Map([
      [1, olderKey.privateKey],
      [2, createHistoryKeyPair().privateKey],
    ]);

    await expect(approveDeviceLink(await lookUpDeviceLink(code))).rejects.toThrow(
      APPROVER_MISSING_HISTORY_KEY_MESSAGE,
    );
    expect(approved).toBeNull();
  });

  test("the scanning phone leaves out an older stored key that doesn't match its published key", async () => {
    publishedHistoryKeys = [
      { publicKey: createHistoryKeyPair().publicKey, version: 1 },
      { publicKey: historyKey.publicKey, version: 2 },
    ];
    heldKeys = new Map([
      [1, createHistoryKeyPair().privateKey],
      [2, historyKey.privateKey],
    ]);
    await approveDeviceLink(await lookUpDeviceLink(code));
    if (!approved) throw new Error("Nothing was approved.");
    thisDevice = { ...newDevice, deviceId: "device-new", userId: "user-1" };

    await finishDeviceLink({ ...approved, approverPublicKey: approver.publicKey, psk });

    expect(stored).toEqual([{ userId: "user-1", version: 2 }]);
  });

  test("the new phone rejects a handover without the current History key", async () => {
    const olderKey = createHistoryKeyPair();
    publishedHistoryKeys = [
      { publicKey: olderKey.publicKey, version: 1 },
      { publicKey: historyKey.publicKey, version: 2 },
    ];
    thisDevice = { ...newDevice, deviceId: "device-new", userId: "user-1" };
    const sealed = sealDeviceLinkHandover({
      approverPrivateKey: approver.privateKey,
      historyKeys: [{ privateKey: olderKey.privateKey, version: 1 }],
      linkId,
      newDeviceId: "device-new",
      newDevicePublicKey: newDevice.publicKey,
      psk,
      userId: "user-1",
    });

    await expect(
      finishDeviceLink({ ...sealed, approverPublicKey: approver.publicKey, linkId, psk }),
    ).rejects.toThrow(HANDOVER_REJECTED_MESSAGE);
    expect(stored).toEqual([]);
    expect(activeDevices).toEqual([]);
  });

  test("the new phone rejects a key that doesn't match the published History public key", async () => {
    const sealed = await approveAndSwitchToNewDevice();
    publishedHistoryKeys = [{ publicKey: createHistoryKeyPair().publicKey, version: 1 }];

    await expect(
      finishDeviceLink({ ...sealed, approverPublicKey: approver.publicKey, psk }),
    ).rejects.toThrow(HANDOVER_REJECTED_MESSAGE);
    expect(stored).toEqual([]);
    expect(activeDevices).toEqual([]);
  });

  test("the new phone rejects a handover without the QR code's secret or from another sender", async () => {
    const sealed = await approveAndSwitchToNewDevice();

    await expect(
      finishDeviceLink({
        ...sealed,
        approverPublicKey: approver.publicKey,
        psk: createDeviceLinkSecret(),
      }),
    ).rejects.toThrow(HANDOVER_REJECTED_MESSAGE);
    await expect(
      finishDeviceLink({ ...sealed, approverPublicKey: createDeviceKeyPair().publicKey, psk }),
    ).rejects.toThrow(HANDOVER_REJECTED_MESSAGE);
    expect(stored).toEqual([]);
  });
});
