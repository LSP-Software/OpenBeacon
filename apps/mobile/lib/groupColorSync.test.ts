import { beforeEach, expect, jest, mock, test } from "bun:test";
import { createDeviceKeyPair, DEVICE_KEY_ALGORITHM } from "@openbeacon/encryption";

type ColorRecord = { groupId: string; ciphertext: string };

const keyPair = createDeviceKeyPair();
const device = {
  deviceId: "device",
  privateKey: keyPair.privateKey,
  publicKey: keyPair.publicKey,
  algorithm: DEVICE_KEY_ALGORITHM,
};
const storageValues = new Map<string, string>();
const uploaded: ColorRecord[] = [];
const updateColor = mock(async (input: ColorRecord, _options: { signal: AbortSignal }) => {
  uploaded.push(input);
});

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));
mock.module("./deviceKeys.ts", () => ({
  getOrCreateDeviceKeyContext: async () => device,
  getStoredDeviceKeyContext: async () => device,
}));
mock.module("./api.ts", () => ({
  trpcClient: {
    groupMembership: {
      updateColor: { mutate: updateColor },
      colors: { query: async () => uploaded },
    },
  },
}));

const { GROUP_COLOR_PALETTE, getGroupColor } = await import("./groupColor.ts");
const { groupColorSyncQueryOptions, saveGroupColor } = await import("./groupColorSync.ts");

beforeEach(() => {
  storageValues.clear();
  uploaded.length = 0;
  updateColor.mockClear();
});

test("restores encrypted group colors from the server and ignores unreadable ones", async () => {
  const color = GROUP_COLOR_PALETTE[3];
  await saveGroupColor({ userId: "owner", groupId: "family", color });
  expect(uploaded[0]?.ciphertext).not.toContain(color);
  uploaded.push(
    { groupId: "friends", ciphertext: uploaded[0]?.ciphertext ?? "" },
    { groupId: "broken", ciphertext: "invalid" },
  );
  storageValues.clear();

  await groupColorSyncQueryOptions("owner").queryFn();

  expect(getGroupColor("family")).toBe(color);
  expect(getGroupColor("friends")).toBe(GROUP_COLOR_PALETTE[0]);
  expect(getGroupColor("broken")).toBe(GROUP_COLOR_PALETTE[0]);
});

test("keeps the previous color when the server rejects the change", async () => {
  updateColor.mockImplementationOnce(async () => {
    throw new Error("Server unavailable");
  });

  await expect(
    saveGroupColor({ userId: "owner", groupId: "family", color: GROUP_COLOR_PALETTE[2] }),
  ).rejects.toThrow("Server unavailable");

  expect(getGroupColor("family")).toBe(GROUP_COLOR_PALETTE[0]);
});

test("aborts and reports an unreachable server after five seconds", async () => {
  jest.useFakeTimers();
  updateColor.mockImplementationOnce(
    (_input, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );

  const pending = saveGroupColor({
    userId: "owner",
    groupId: "family",
    color: GROUP_COLOR_PALETTE[2],
  });
  while (updateColor.mock.calls.length === 0) await Promise.resolve();
  jest.advanceTimersByTime(4_999);
  expect(updateColor.mock.calls[0]?.[1].signal.aborted).toBe(false);
  jest.advanceTimersByTime(1);

  await expect(pending).rejects.toThrow("Couldn't reach the server");
  expect(getGroupColor("family")).toBe(GROUP_COLOR_PALETTE[0]);
  jest.useRealTimers();
});
