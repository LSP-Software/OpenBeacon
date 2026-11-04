import { expect, mock, test } from "bun:test";
import { createDeviceKeyPair, DEVICE_KEY_ALGORITHM } from "@openbeacon/encryption";

const first = createDeviceKeyPair();
const second = createDeviceKeyPair();
let current = {
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

test("encrypts locally with the private key and binds the owner, group, and member", async () => {
  const context = { groupId: "family", memberId: "member", userId: "owner" };
  const ciphertext = await encryptPersonalNickname({ ...context, nickname: "Grandma" });
  expect(ciphertext).not.toContain("Grandma");
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBe("Grandma");
  for (const changed of [{ groupId: "other" }, { memberId: "other" }, { userId: "other" }]) {
    await expect(decryptPersonalNickname({ ...context, ...changed, ciphertext })).rejects.toThrow();
  }
  current = {
    deviceId: "second",
    privateKey: second.privateKey,
    publicKey: second.publicKey,
    algorithm: DEVICE_KEY_ALGORITHM,
  };
  expect(await decryptPersonalNickname({ ...context, ciphertext })).toBeNull();
  current.deviceId = "first";
  await expect(decryptPersonalNickname({ ...context, ciphertext })).rejects.toThrow();
});

test("silently falls back when a nickname cannot be decrypted and permits replacement", async () => {
  const context = { groupId: "family", memberId: "member", userId: "owner" };
  current = {
    deviceId: "first",
    privateKey: first.privateKey,
    publicKey: first.publicKey,
    algorithm: DEVICE_KEY_ALGORITHM,
  };
  const oldCiphertext = await encryptPersonalNickname({ ...context, nickname: "Gran" });
  nicknameQuery.mockResolvedValue([
    { targetId: "member", ciphertext: oldCiphertext },
    { targetId: "broken", ciphertext: "invalid" },
  ]);
  current = {
    deviceId: "second",
    privateKey: second.privateKey,
    publicKey: second.publicKey,
    algorithm: DEVICE_KEY_ALGORITHM,
  };
  const records = await loadPersonalNicknames(context.groupId, context.userId);
  expect(records["member"]).toEqual({ name: null, ciphertext: oldCiphertext });
  expect(records["broken"]).toEqual({ name: null, ciphertext: "invalid" });
  const replacement = await encryptPersonalNickname({ ...context, nickname: "Grandma" });
  expect(await decryptPersonalNickname({ ...context, ciphertext: replacement })).toBe("Grandma");
});
