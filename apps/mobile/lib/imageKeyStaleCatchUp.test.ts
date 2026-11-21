import { beforeEach, expect, mock, test } from "bun:test";
import {
  decryptImageKey,
  type EncryptedImageKey,
  encryptImageKey,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  generateImageKey,
  type ImageKeyMaterial,
} from "@openbeacon/encryption";

const BEA_FILE = "33333333-3333-4333-8333-333333333333";
const url = (fileName: string) => `https://images.example.test/${fileName}`;

type Group = {
  id: string;
  name: string;
  image: string | null;
  imageKey: EncryptedImageKey | null;
  latestEpochId: string | null;
  members: {
    id: string;
    userId: string;
    name: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    image: string | null;
    imageKey: EncryptedImageKey | null;
  }[];
};

const serverEpochKeys = new Map<string, EpochKeyMaterial>();
const readableEpochs = new Set<string>();
const storageValues = new Map<string, string | number>();
const reEncryptCalls: { epochIds: string[] }[] = [];
let beaKey: ImageKeyMaterial;
let group: Group;
let groupRuns = 0;

const wrapForBea = (epochId: string) =>
  encryptImageKey({
    epochId,
    epochKey: serverEpochKeys.get(epochId)!,
    fileName: BEA_FILE,
    groupId: group.id,
    imageKey: beaKey,
    kind: "profile-image-key",
    ownerId: "user-b",
    senderDeviceId: "device-b",
  });

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => {
      const value = storageValues.get(key);
      return typeof value === "string" ? value : undefined;
    },
    getNumber: (key: string) => {
      const value = storageValues.get(key);
      return typeof value === "number" ? value : undefined;
    },
    set: (key: string, value: string | number) => {
      storageValues.set(key, value);
    },
  },
}));
mock.module("./currentServer.ts", () => ({ getBaseUrl: () => "https://api.example.test" }));
mock.module("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));
mock.module("./api.ts", () => ({
  trpcClient: {
    groupMembership: { list: { query: async () => [structuredClone(group)] } },
    groupEpoch: { getLatest: { query: async () => ({ epochId: group.latestEpochId }) } },
    groupImageKeys: {
      reEncrypt: {
        mutate: async (input: {
          groupId: string;
          keys: {
            target: { kind: "group" } | { kind: "member"; memberId: string };
            expectedCiphertext: string;
            key: EncryptedImageKey;
          }[];
        }) => {
          reEncryptCalls.push({ epochIds: input.keys.map(({ key }) => key.epochId) });
          const reEncrypted = [];
          for (const request of input.keys) {
            const holder = group.members.find(
              ({ id }) => request.target.kind === "member" && id === request.target.memberId,
            );
            if (holder?.imageKey?.ciphertext !== request.expectedCiphertext) continue;
            holder.imageKey = request.key;
            reEncrypted.push(request.target);
          }
          return { reEncrypted, skipped: [], changed: [], gone: [] };
        },
      },
    },
  },
}));
mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({ deviceId: "device-a", userId: "user-a" }),
}));
mock.module("./epochKeys.ts", () => ({
  resolveEpochKey: async ({ epochId }: { epochId: string }) =>
    readableEpochs.has(epochId) ? (serverEpochKeys.get(epochId) ?? null) : null,
}));
mock.module("./groupEncryption.ts", () => ({ rotateGroupEpochIfRequired: async () => false }));
mock.module("./decryptedImages.ts", () => ({
  downloadEncryptedImage: async () => {
    throw new Error("no downloads expected");
  },
}));
mock.module("./image-upload.ts", () => ({
  uploadEncryptedImage: async () => {
    throw new Error("no uploads expected");
  },
}));
mock.module("./imageKeys.ts", () => ({
  confirmGroupImage: async () => {
    throw new Error("no group picture confirms expected");
  },
  getOwnImageKey: async () => null,
  storeOwnImageKeyInGroup: async () => false,
}));

const { checkImageKeys, resetImageKeyCheck } = await import("./imageKeySelfCheck.ts");

const user = { id: "user-a", image: null, imageKeySealed: null };

beforeEach(() => {
  groupRuns += 1;
  serverEpochKeys.clear();
  readableEpochs.clear();
  storageValues.clear();
  reEncryptCalls.length = 0;
  resetImageKeyCheck();
  for (const epochId of ["epoch-1", "epoch-2"]) {
    serverEpochKeys.set(epochId, generateGroupEpochKey());
  }
  beaKey = generateImageKey();
  group = {
    id: `family-${groupRuns}`,
    name: "Family",
    image: null,
    imageKey: null,
    latestEpochId: "epoch-2",
    members: [
      { id: "m-a", userId: "user-a", name: "Ana", role: "MEMBER", image: null, imageKey: null },
      { id: "m-b", userId: "user-b", name: "Bea", role: "MEMBER", image: null, imageKey: null },
    ],
  };
  group.members[1]!.image = url(BEA_FILE);
  group.members[1]!.imageKey = wrapForBea("epoch-1");
});

test("a phone that can read the old epoch moves a stale key to the latest one the list names", async () => {
  readableEpochs.add("epoch-1");
  readableEpochs.add("epoch-2");

  expect(await checkImageKeys({ groups: [structuredClone(group)], user })).toBe(true);

  expect(reEncryptCalls).toEqual([{ epochIds: ["epoch-2"] }]);
  const moved = group.members[1]!.imageKey!;
  expect(moved.epochId).toBe("epoch-2");
  expect(
    decryptImageKey({
      encryptedKey: moved,
      epochKey: serverEpochKeys.get("epoch-2")!,
      fileName: BEA_FILE,
      groupId: group.id,
      kind: "profile-image-key",
      ownerId: "user-b",
    }).expose(),
  ).toEqual(beaKey.expose());

  expect(await checkImageKeys({ groups: [structuredClone(group)], user })).toBe(false);
  expect(reEncryptCalls).toHaveLength(1);
});

test("a newcomer who can't read the old epoch sends nothing and leaves the key alone", async () => {
  readableEpochs.add("epoch-2");
  const before = group.members[1]!.imageKey;

  expect(await checkImageKeys({ groups: [structuredClone(group)], user })).toBe(false);

  expect(reEncryptCalls).toEqual([]);
  expect(group.members[1]!.imageKey).toEqual(before);
});
