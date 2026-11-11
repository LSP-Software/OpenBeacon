import { beforeEach, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  DevicePrivateKeyMaterial,
  getPersonalDataHistoryKeyVersion,
  type HistoryPrivateKeyMaterial,
  sealPersonalData,
} from "@openbeacon/encryption";

const first = createDeviceKeyPair();
const second = createDeviceKeyPair();
const historyKey = createHistoryKeyPair();
let heldHistoryKey: HistoryPrivateKeyMaterial | null = historyKey.privateKey;
let current: {
  deviceId: string;
  privateKey: DevicePrivateKeyMaterial;
  publicKey: string;
  algorithm: typeof DEVICE_KEY_ALGORITHM;
} | null = {
  deviceId: "first",
  privateKey: first.privateKey,
  publicKey: first.publicKey,
  algorithm: DEVICE_KEY_ALGORITHM,
};
const nicknameQuery = mock(async () => [] as { targetId: string; ciphertext: string }[]);
mock.module("./api.ts", () => ({
  trpcClient: {
    accountRecovery: {
      status: {
        query: async () => ({
          currentHistoryKey: { publicKey: historyKey.publicKey, version: 1 },
          recoveryKey: null,
        }),
      },
    },
    groupMembership: { nicknames: { query: nicknameQuery } },
  },
}));
mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => current,
  getStoredDeviceKeyContext: async () => current,
}));
mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async () => heldHistoryKey,
  storeHistoryKey: async () => {},
}));
const { encryptPersonalNickname, decryptPersonalNickname, loadPersonalNicknames } =
  await import("./personalNicknames.ts");
const { PERSONAL_DATA_ON_OTHER_DEVICE_MESSAGE } = await import("./personalData.ts");

const context = { groupId: "family", memberId: "member", userId: "owner" };
const useKey = (deviceId: string, keyPair: ReturnType<typeof createDeviceKeyPair>) => {
  current = {
    deviceId,
    privateKey: new DevicePrivateKeyMaterial(keyPair.privateKey.expose()),
    publicKey: keyPair.publicKey,
    algorithm: DEVICE_KEY_ALGORITHM,
  };
};
const sealV2 = (keyPair: ReturnType<typeof createDeviceKeyPair>, nickname: string) =>
  sealPersonalData({
    privateKey: keyPair.privateKey,
    purpose: "nickname",
    binding: [context.userId, context.groupId, context.memberId],
    plaintext: nickname,
  });

beforeEach(() => {
  heldHistoryKey = historyKey.privateKey;
  useKey("first", first);
});

test("binds the nickname to the owner, group, and member under the current History key", async () => {
  const ciphertext = await encryptPersonalNickname({ ...context, nickname: "Grandma" });
  expect(ciphertext).not.toContain("Grandma");
  expect(getPersonalDataHistoryKeyVersion(ciphertext)).toBe(1);
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBe("Grandma");
  for (const changed of [{ groupId: "other" }, { memberId: "other" }, { userId: "other" }]) {
    await expect(decryptPersonalNickname({ ...context, ...changed, ciphertext })).rejects.toThrow();
  }
});

test("another phone holding the History key reads the nickname", async () => {
  const ciphertext = await encryptPersonalNickname({ ...context, nickname: "Grandma" });
  useKey("second", second);
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBe("Grandma");
  heldHistoryKey = null;
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBeNull();
});

test("a phone without the History key refuses to write a nickname", async () => {
  heldHistoryKey = null;
  await expect(encryptPersonalNickname({ ...context, nickname: "Grandma" })).rejects.toThrow(
    PERSONAL_DATA_ON_OTHER_DEVICE_MESSAGE,
  );
});

test("an older nickname sealed to a device key still opens on that device only", async () => {
  const ciphertext = sealV2(first, "Grandma");
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBe("Grandma");
  useKey("first", second);
  await expect(decryptPersonalNickname({ ...context, ciphertext })).rejects.toThrow();
  current = null;
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBeNull();
});

test("silently falls back when a nickname cannot be decrypted and permits replacement", async () => {
  const oldCiphertext = sealV2(first, "Gran");
  nicknameQuery.mockResolvedValue([
    { targetId: "member", ciphertext: oldCiphertext },
    { targetId: "broken", ciphertext: "invalid" },
  ]);
  useKey("second", second);
  const records = await loadPersonalNicknames(context.groupId, context.userId);
  expect(records["member"]).toEqual({ name: null, ciphertext: oldCiphertext });
  expect(records["broken"]).toEqual({ name: null, ciphertext: "invalid" });
  const replacement = await encryptPersonalNickname({ ...context, nickname: "Grandma" });
  expect(await decryptPersonalNickname({ ...context, ciphertext: replacement })).toBe("Grandma");
});
