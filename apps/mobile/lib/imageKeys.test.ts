import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createHistoryKeyPair,
  decryptImageKey,
  type EncryptedImageKey,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  generateImageKey,
  type ImageKeyMaterial,
  type ImageKeyKind,
  openPersonalData,
  openProfileImageKey,
  type PersonalDataPurpose,
  sealProfileImageKey,
} from "@openbeacon/encryption";

const history = createHistoryKeyPair();
const historyKey = { publicKey: history.publicKey, version: 2 };
const epochKeys = new Map<string, EpochKeyMaterial>();
const epochKeyFor = (epochId: string) => {
  const existing = epochKeys.get(epochId);
  if (existing) return existing;
  const created = generateGroupEpochKey();
  epochKeys.set(epochId, created);
  return created;
};

const reasonError = (reason: string) => Object.assign(new Error(reason), { data: { reason } });

let groups: string[] = [];
let latestEpochs = new Map<string, string[]>();
let unreadableEpochs = new Set<string>();
let historyState: "held" | "onOtherDevice" = "held";
let failures: unknown[] = [];
let sessions: { id: string; image: string | null; imageKeySealed: string | null }[] = [];
let ownKeys = new Map<string, { fileName: string; key: ImageKeyMaterial }>();
let profileConfirms: {
  wraps: (EncryptedImageKey & { groupId: string })[];
  sealed?: string;
}[] = [];
let groupConfirms: { groupId: string; key: EncryptedImageKey }[] = [];
let stores: { fileName: string; groupId: string; key: EncryptedImageKey }[] = [];
const rotate = mock(async (_groupId: string) => true);
const relink = mock(async (_options?: { linkSession?: boolean }) => device);
const device = { deviceId: "device-a", userId: "user-a" };

const failOrReturn = <T>(value: T) => {
  const failure = failures.shift();
  if (failure) throw failure;
  return value;
};

mock.module("./api.ts", () => ({
  trpcClient: {
    groupMembership: { list: { query: async () => groups.map((id) => ({ id })) } },
    groupEpoch: {
      getLatest: {
        query: async ({ groupId }: { groupId: string }) => {
          const queue = latestEpochs.get(groupId) ?? [];
          const epochId = queue.length > 1 ? queue.shift() : queue[0];
          return epochId ? { epochId } : null;
        },
      },
    },
    account: {
      confirmProfileImageUpload: {
        mutate: async (input: (typeof profileConfirms)[number]) => {
          profileConfirms.push(input);
          return failOrReturn({ imageUrl: "https://cdn.example/profile" });
        },
      },
    },
    groupSettings: {
      confirmGroupImageUpload: {
        mutate: async (input: (typeof groupConfirms)[number]) => {
          groupConfirms.push(input);
          return failOrReturn({ imageUrl: "https://cdn.example/group" });
        },
      },
    },
    groupImageKeys: {
      store: {
        mutate: async (input: (typeof stores)[number]) => {
          stores.push(input);
          return failOrReturn({ imageKey: input.key });
        },
      },
    },
  },
}));
mock.module("./auth-client.ts", () => ({
  authClient: {
    getSession: async () => {
      const user = sessions.length > 1 ? sessions.shift() : sessions[0];
      return { data: user ? { user } : null };
    },
  },
}));
mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async (options?: { linkSession?: boolean }) =>
    options ? relink(options) : device,
}));
mock.module("./epochKeys.ts", () => ({
  resolveEpochKey: async ({ epochId }: { epochId: string }) =>
    unreadableEpochs.has(epochId) ? null : epochKeyFor(epochId),
}));
mock.module("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));
mock.module("./groupEncryption.ts", () => ({ rotateGroupEpochIfRequired: rotate }));
mock.module("./currentHistoryKey.ts", () => ({
  getCurrentHistoryKeyState: async () =>
    historyState === "held"
      ? { status: "held", historyKey }
      : { status: "onOtherDevice", version: historyKey.version },
}));
mock.module("./ownImageKey.ts", () => ({
  readOwnImageKey: async ({ fileName, userId }: { fileName: string; userId: string }) => {
    const stored = ownKeys.get(userId);
    return stored?.fileName === fileName ? stored.key : null;
  },
  storeOwnImageKey: async ({
    fileName,
    imageKey,
    userId,
  }: {
    fileName: string;
    imageKey: ImageKeyMaterial;
    userId: string;
  }) => {
    ownKeys.set(userId, { fileName, key: imageKey });
  },
}));
mock.module("./personalData.ts", () => ({
  createPersonalDataOpener:
    () =>
    async ({
      binding,
      purpose,
      sealed,
    }: {
      binding: string[];
      purpose: PersonalDataPurpose;
      sealed: string;
    }) =>
      openPersonalData({
        historyPrivateKeys: new Map([[historyKey.version, history.privateKey]]),
        purpose,
        binding,
        sealed,
      }),
}));

const { confirmGroupImage, confirmProfileImage, storeOwnImageKeyInGroup } =
  await import("./imageKeys.ts");

const openWrap = ({
  fileName,
  groupId,
  kind,
  ownerId,
  wrap,
}: {
  fileName: string;
  groupId: string;
  kind: ImageKeyKind;
  ownerId: string;
  wrap: EncryptedImageKey;
}) =>
  decryptImageKey({
    encryptedKey: wrap,
    epochKey: epochKeyFor(wrap.epochId),
    fileName,
    groupId,
    kind,
    ownerId,
  }).expose();

const fileName = "0b6f7d1e-3c2a-4b8e-9f10-2a3b4c5d6e7f";
const newerFileName = "1c7a8e2f-4d3b-4c9f-8a21-3b4c5d6e7f80";
const pictureUrl = (name: string) =>
  `https://cdn.example/images/user/user-a/uploads/avatar/${name}`;

beforeEach(() => {
  groups = [];
  latestEpochs = new Map();
  unreadableEpochs = new Set();
  historyState = "held";
  failures = [];
  sessions = [];
  ownKeys = new Map();
  profileConfirms = [];
  groupConfirms = [];
  stores = [];
  rotate.mockClear();
  relink.mockClear();
});

describe("confirmProfileImage", () => {
  test("wraps the picture key once per group under each group's latest epoch", async () => {
    groups = ["family", "friends"];
    latestEpochs = new Map([
      ["family", ["family-epoch-3"]],
      ["friends", ["friends-epoch-1"]],
    ]);
    const imageKey = generateImageKey();

    await confirmProfileImage({ fileName, imageKey, userId: "user-a" });

    const [{ wraps }] = profileConfirms as [(typeof profileConfirms)[number]];
    expect(wraps.map(({ groupId, epochId }) => [groupId, epochId]).sort()).toEqual([
      ["family", "family-epoch-3"],
      ["friends", "friends-epoch-1"],
    ]);
    for (const wrap of wraps) {
      expect(wrap.senderDeviceId).toBe("device-a");
      expect(
        openWrap({
          fileName,
          groupId: wrap.groupId,
          kind: "profile-image-key",
          ownerId: "user-a",
          wrap,
        }),
      ).toEqual(imageKey.expose());
    }
  });

  test("skips a group whose key this phone can't read instead of failing the upload", async () => {
    groups = ["family", "friends"];
    latestEpochs = new Map([
      ["family", ["family-epoch-3"]],
      ["friends", ["friends-epoch-1"]],
    ]);
    unreadableEpochs = new Set(["friends-epoch-1"]);

    await confirmProfileImage({ fileName, imageKey: generateImageKey(), userId: "user-a" });

    expect(profileConfirms[0]!.wraps.map(({ groupId }) => groupId)).toEqual(["family"]);
  });

  test("adds the sealed personal copy when this phone holds the history key", async () => {
    const imageKey = generateImageKey();

    await confirmProfileImage({ fileName, imageKey, userId: "user-a" });

    const sealed = profileConfirms[0]!.sealed!;
    expect(
      openProfileImageKey({
        fileName,
        historyPrivateKeys: new Map([[historyKey.version, history.privateKey]]),
        sealed,
        userId: "user-a",
      }).expose(),
    ).toEqual(imageKey.expose());
  });

  test("still confirms without the sealed copy when the history key is on another phone", async () => {
    historyState = "onOtherDevice";
    groups = ["family"];
    latestEpochs = new Map([["family", ["family-epoch-1"]]]);

    await confirmProfileImage({ fileName, imageKey: generateImageKey(), userId: "user-a" });

    expect(profileConfirms).toHaveLength(1);
    expect(profileConfirms[0]).not.toHaveProperty("sealed");
    expect(profileConfirms[0]!.wraps).toHaveLength(1);
  });

  test("keeps its own picture key on this phone after confirming", async () => {
    const imageKey = generateImageKey();

    await confirmProfileImage({ fileName, imageKey, userId: "user-a" });

    expect(ownKeys.get("user-a")?.fileName).toBe(fileName);
    expect(ownKeys.get("user-a")?.key.expose()).toEqual(imageKey.expose());
  });

  test("relinks this phone and confirms again when the server doesn't know the device", async () => {
    failures = [reasonError("DEVICE_NOT_REGISTERED")];

    await confirmProfileImage({ fileName, imageKey: generateImageKey(), userId: "user-a" });

    expect(relink).toHaveBeenCalledWith({ linkSession: true });
    expect(profileConfirms).toHaveLength(2);
  });

  test("doesn't keep the key when the confirm fails", async () => {
    failures = [new Error("offline")];

    await expect(
      confirmProfileImage({ fileName, imageKey: generateImageKey(), userId: "user-a" }),
    ).rejects.toThrow("offline");
    expect(ownKeys.size).toBe(0);
  });
});

describe("confirmGroupImage", () => {
  test("wraps the group picture key under the latest epoch", async () => {
    latestEpochs = new Map([["family", ["epoch-2"]]]);
    const imageKey = generateImageKey();

    await confirmGroupImage({ fileName, groupId: "family", imageKey });

    const [{ key }] = groupConfirms as [(typeof groupConfirms)[number]];
    expect(key.epochId).toBe("epoch-2");
    expect(
      openWrap({
        fileName,
        groupId: "family",
        kind: "group-image-key",
        ownerId: "family",
        wrap: key,
      }),
    ).toEqual(imageKey.expose());
  });

  test("re-wraps under the new epoch after EPOCH_NOT_LATEST", async () => {
    latestEpochs = new Map([["family", ["epoch-2", "epoch-3"]]]);
    failures = [reasonError("EPOCH_NOT_LATEST")];
    const imageKey = generateImageKey();

    await confirmGroupImage({ fileName, groupId: "family", imageKey });

    expect(groupConfirms.map(({ key }) => key.epochId)).toEqual(["epoch-2", "epoch-3"]);
    expect(
      openWrap({
        fileName,
        groupId: "family",
        kind: "group-image-key",
        ownerId: "family",
        wrap: groupConfirms[1]!.key,
      }),
    ).toEqual(imageKey.expose());
    expect(rotate).not.toHaveBeenCalled();
  });

  test("finishes a pending rotation and confirms again", async () => {
    latestEpochs = new Map([["family", ["epoch-2", "epoch-3"]]]);
    failures = [reasonError("EPOCH_ROTATION_PENDING")];

    await confirmGroupImage({ fileName, groupId: "family", imageKey: generateImageKey() });

    expect(rotate).toHaveBeenCalledWith("family");
    expect(groupConfirms.map(({ key }) => key.epochId)).toEqual(["epoch-2", "epoch-3"]);
  });

  test("gives up after three refusals", async () => {
    latestEpochs = new Map([["family", ["epoch-2"]]]);
    failures = [
      reasonError("EPOCH_NOT_LATEST"),
      reasonError("EPOCH_NOT_LATEST"),
      reasonError("EPOCH_NOT_LATEST"),
    ];

    await expect(
      confirmGroupImage({ fileName, groupId: "family", imageKey: generateImageKey() }),
    ).rejects.toMatchObject({ data: { reason: "EPOCH_NOT_LATEST" } });
    expect(groupConfirms).toHaveLength(3);
  });

  test("doesn't confirm when this phone can't read the latest epoch", async () => {
    latestEpochs = new Map([["family", ["epoch-2"]]]);
    unreadableEpochs = new Set(["epoch-2"]);

    await expect(
      confirmGroupImage({ fileName, groupId: "family", imageKey: generateImageKey() }),
    ).rejects.toThrow("current key");
    expect(groupConfirms).toHaveLength(0);
  });
});

describe("storeOwnImageKeyInGroup", () => {
  test("stores the key this phone kept, under the new group's latest epoch", async () => {
    const imageKey = generateImageKey();
    ownKeys.set("user-a", { fileName, key: imageKey });
    sessions = [{ id: "user-a", image: pictureUrl(fileName), imageKeySealed: null }];
    latestEpochs = new Map([["family", ["epoch-4"]]]);

    expect(await storeOwnImageKeyInGroup("family")).toBe(true);

    const [store] = stores as [(typeof stores)[number]];
    expect(store.fileName).toBe(fileName);
    expect(store.key.epochId).toBe("epoch-4");
    expect(
      openWrap({
        fileName,
        groupId: "family",
        kind: "profile-image-key",
        ownerId: "user-a",
        wrap: store.key,
      }),
    ).toEqual(imageKey.expose());
  });

  test("opens the sealed copy when this phone doesn't have the key", async () => {
    const imageKey = generateImageKey();
    sessions = [
      {
        id: "user-a",
        image: pictureUrl(fileName),
        imageKeySealed: sealProfileImageKey({ fileName, historyKey, imageKey, userId: "user-a" }),
      },
    ];
    latestEpochs = new Map([["family", ["epoch-4"]]]);

    await storeOwnImageKeyInGroup("family");

    expect(
      openWrap({
        fileName,
        groupId: "family",
        kind: "profile-image-key",
        ownerId: "user-a",
        wrap: stores[0]!.key,
      }),
    ).toEqual(imageKey.expose());
    expect(ownKeys.get("user-a")?.key.expose()).toEqual(imageKey.expose());
  });

  test("fetches the new picture and tries once more after IMAGE_CHANGED", async () => {
    const oldKey = generateImageKey();
    const newKey = generateImageKey();
    ownKeys.set("user-a", { fileName, key: oldKey });
    sessions = [
      { id: "user-a", image: pictureUrl(fileName), imageKeySealed: null },
      {
        id: "user-a",
        image: pictureUrl(newerFileName),
        imageKeySealed: sealProfileImageKey({
          fileName: newerFileName,
          historyKey,
          imageKey: newKey,
          userId: "user-a",
        }),
      },
    ];
    latestEpochs = new Map([["family", ["epoch-4"]]]);
    failures = [reasonError("IMAGE_CHANGED")];

    expect(await storeOwnImageKeyInGroup("family")).toBe(true);

    expect(stores.map((store) => store.fileName)).toEqual([fileName, newerFileName]);
    expect(
      openWrap({
        fileName: newerFileName,
        groupId: "family",
        kind: "profile-image-key",
        ownerId: "user-a",
        wrap: stores[1]!.key,
      }),
    ).toEqual(newKey.expose());
  });

  test("does nothing without a picture or a key to share", async () => {
    sessions = [{ id: "user-a", image: null, imageKeySealed: null }];
    expect(await storeOwnImageKeyInGroup("family")).toBe(false);

    sessions = [{ id: "user-a", image: pictureUrl(fileName), imageKeySealed: null }];
    expect(await storeOwnImageKeyInGroup("family")).toBe(false);
    expect(stores).toHaveLength(0);
  });

  test("ignores a sealed copy that doesn't open", async () => {
    const otherHistory = createHistoryKeyPair();
    sessions = [
      {
        id: "user-a",
        image: pictureUrl(fileName),
        imageKeySealed: sealProfileImageKey({
          fileName,
          historyKey: { publicKey: otherHistory.publicKey, version: historyKey.version },
          imageKey: generateImageKey(),
          userId: "user-a",
        }),
      },
    ];

    expect(await storeOwnImageKeyInGroup("family")).toBe(false);
    expect(stores).toHaveLength(0);
  });
});
