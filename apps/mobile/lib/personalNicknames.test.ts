import { expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  DEVICE_KEY_ALGORITHM,
  DevicePrivateKeyMaterial,
} from "@openbeacon/encryption";

const first = createDeviceKeyPair();
const second = createDeviceKeyPair();
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
  trpcClient: { groupMembership: { nicknames: { query: nicknameQuery } } },
}));
mock.module("./deviceKeys.ts", () => ({
  getOrCreateDeviceKeyContext: async () => current,
  getStoredDeviceKeyContext: async () => current,
}));
const { encryptPersonalNickname, decryptPersonalNickname, loadPersonalNicknames } =
  await import("./personalNicknames.ts");

const context = { groupId: "family", memberId: "member", userId: "owner" };
const useKey = (deviceId: string, keyPair: ReturnType<typeof createDeviceKeyPair>) => {
  current = {
    deviceId,
    privateKey: new DevicePrivateKeyMaterial(keyPair.privateKey.expose()),
    publicKey: keyPair.publicKey,
    algorithm: DEVICE_KEY_ALGORITHM,
  };
};

test("binds the nickname to the owner, group, and member", async () => {
  useKey("first", first);
  const ciphertext = await encryptPersonalNickname({ ...context, nickname: "Grandma" });
  expect(ciphertext).not.toContain("Grandma");
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBe("Grandma");
  for (const changed of [{ groupId: "other" }, { memberId: "other" }, { userId: "other" }]) {
    await expect(decryptPersonalNickname({ ...context, ...changed, ciphertext })).rejects.toThrow();
  }
});

test("restoring the private key on a new device restores the nickname", async () => {
  useKey("first", first);
  const ciphertext = await encryptPersonalNickname({ ...context, nickname: "Grandma" });
  useKey("restored-device", first);
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBe("Grandma");
  useKey("first", second);
  await expect(decryptPersonalNickname({ ...context, ciphertext })).rejects.toThrow();
  current = null;
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBeNull();
});

test("silently falls back when a nickname cannot be decrypted and permits replacement", async () => {
  useKey("first", first);
  const oldCiphertext = await encryptPersonalNickname({ ...context, nickname: "Gran" });
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
