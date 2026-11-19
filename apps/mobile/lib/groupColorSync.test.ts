import { beforeEach, expect, jest, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  getPersonalDataHistoryKeyVersion,
} from "@openbeacon/encryption";

type ColorRecord = { groupId: string; ciphertext: string };
type ColorUpdate = ColorRecord & { expectedCiphertext: string | null };

const keyPair = createDeviceKeyPair();
const historyKey = createHistoryKeyPair();
const device = {
  deviceId: "device",
  privateKey: keyPair.privateKey,
  publicKey: keyPair.publicKey,
  algorithm: DEVICE_KEY_ALGORITHM,
};
const storageValues = new Map<string, string>();
const uploaded: ColorRecord[] = [];
const updateColor = mock(async (input: ColorUpdate, _options: { signal: AbortSignal }) => {
  const index = uploaded.findIndex((record) => record.groupId === input.groupId);
  if ((uploaded[index]?.ciphertext ?? null) !== input.expectedCiphertext) {
    throw new Error("Group colour changed. Reload and try again.");
  }
  const record = { groupId: input.groupId, ciphertext: input.ciphertext };
  if (index === -1) uploaded.push(record);
  else uploaded[index] = record;
});

mock.module("./storage.ts", () => ({
  storage: {
    getAllKeys: () => [...storageValues.keys()],
    getString: (key: string) => storageValues.get(key),
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));
mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => device,
  getStoredDeviceKeyContext: async () => device,
}));
mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async () => historyKey.privateKey,
  storeHistoryKey: async () => {},
  deleteStoredHistoryKeys: async () => {},
}));
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
    groupMembership: {
      updateColor: { mutate: updateColor },
      colors: { query: async () => uploaded },
    },
  },
}));

const { clearGroupColors, GROUP_COLOR_PALETTE, getGroupColor } = await import("./groupColor.ts");
const { groupColorSyncQueryOptions, saveGroupColor } = await import("./groupColorSync.ts");

beforeEach(() => {
  clearGroupColors();
  storageValues.clear();
  uploaded.length = 0;
  updateColor.mockClear();
});

test("restores encrypted group colors from the server and ignores unreadable ones", async () => {
  const color = GROUP_COLOR_PALETTE[3];
  await saveGroupColor({ userId: "owner", groupId: "family", color });
  expect(uploaded[0]?.ciphertext).not.toContain(color);
  expect(getPersonalDataHistoryKeyVersion(uploaded[0]?.ciphertext ?? "")).toBe(1);
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

  await expect(pending).rejects.toThrow("Couldn’t reach the server");
  expect(getGroupColor("family")).toBe(GROUP_COLOR_PALETTE[0]);
  jest.useRealTimers();
});

test("each save expects the colour this phone last read or saved", async () => {
  await saveGroupColor({ userId: "owner", groupId: "family", color: GROUP_COLOR_PALETTE[2] });
  const first = uploaded[0]?.ciphertext;
  await saveGroupColor({ userId: "owner", groupId: "family", color: GROUP_COLOR_PALETTE[4] });

  expect(updateColor.mock.calls.map(([input]) => input.expectedCiphertext)).toStrictEqual([
    null,
    first ?? "",
  ]);
  expect(getGroupColor("family")).toBe(GROUP_COLOR_PALETTE[4]);
});

test("a colour another phone saved after this one read is never overwritten", async () => {
  await saveGroupColor({ userId: "owner", groupId: "family", color: GROUP_COLOR_PALETTE[2] });
  await groupColorSyncQueryOptions("owner").queryFn();
  const otherPhone = { groupId: "family", ciphertext: "sealed-by-another-phone" };
  uploaded[0] = otherPhone;

  await expect(
    saveGroupColor({ userId: "owner", groupId: "family", color: GROUP_COLOR_PALETTE[5] }),
  ).rejects.toThrow("Group colour changed");

  expect(uploaded).toStrictEqual([otherPhone]);
  expect(getGroupColor("family")).toBe(GROUP_COLOR_PALETTE[2]);
});
