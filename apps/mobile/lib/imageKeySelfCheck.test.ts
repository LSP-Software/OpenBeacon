import { beforeEach, expect, jest, mock, test } from "bun:test";
import {
  type EncryptedImageKey,
  encryptImage,
  encryptImageKey,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  generateImageKey,
  type ImageKeyKind,
  type ImageKeyMaterial,
} from "@openbeacon/encryption";
import { imageFileNameSchema } from "@openbeacon/schemas";

const GROUP_FILE = "11111111-1111-4111-8111-111111111111";
const ME_FILE = "22222222-2222-4222-8222-222222222222";
const NEW_GROUP_FILE = "66666666-6666-4666-8666-666666666666";
const plainPicture = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

const url = (fileName: string) => `https://images.example.test/${fileName}`;

type Group = {
  id: string;
  name: string;
  image: string | null;
  imageKey: EncryptedImageKey | null;
  ownerId: string;
  ownershipOfferedToId: string | null;
  onHold: boolean;
  members: {
    id: string;
    userId: string;
    name: string;
    image: string | null;
    imageKey: EncryptedImageKey | null;
    role: "ADMIN" | "EDITOR" | "MEMBER";
  }[];
};

const epochKeys = new Map<string, EpochKeyMaterial>();
const cached = new Map<string, Uint8Array>();
let groupId = "";
let groupRuns = 0;
let ownKey: ImageKeyMaterial | null;
let groupPictureKey: ImageKeyMaterial;
let groupBlob: Uint8Array;
let downloadFails = false;
let downloadGate: Promise<void> | null = null;
let serverGroups: Group[] | null = null;
let lastChecked: Group[] = [];
const ownKeyGroups: unknown[] = [];
const reads: string[] = [];
const storageValues = new Map<string, string | number>();
const downloads: string[] = [];
const uploads: { bytes: Uint8Array; ownerId: string; purpose: string }[] = [];
const groupConfirms: {
  expectedFileName: string | null | undefined;
  fileName: string;
  groupId: string;
}[] = [];
let confirmError: Error | null = null;
const storeOwn = mock(async (_groupId: string) => true);

const wrap = ({
  epochId = "epoch-2",
  fileName,
  imageKey,
  kind,
  ownerId,
}: {
  epochId?: string;
  fileName: string;
  imageKey: ImageKeyMaterial;
  kind: ImageKeyKind;
  ownerId: string;
}) =>
  encryptImageKey({
    epochId,
    epochKey: epochKeys.get(epochId)!,
    fileName,
    groupId,
    imageKey,
    kind,
    ownerId,
    senderDeviceId: "device-other",
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
mock.module("./currentServer.ts", () => ({ baseUrl: "https://api.example.test" }));
mock.module("./api.ts", () => ({
  trpcClient: {
    groupMembership: {
      list: { query: async () => structuredClone(serverGroups ?? lastChecked) },
    },
    groupSettings: {
      requestGroupImageUpload: { mutate: async () => ({ fileName: NEW_GROUP_FILE }) },
      presignGroupImageUpload: {
        mutate: async () => ({ presignedUrl: "https://put.example.test" }),
      },
    },
  },
}));
mock.module("./decryptedImages.ts", () => ({
  downloadEncryptedImage: async (downloadUrl: string) => {
    downloads.push(downloadUrl);
    await downloadGate;
    if (downloadFails) throw new Error("offline");
    return groupBlob;
  },
}));
mock.module("./epochKeys.ts", () => ({
  resolveEpochKey: async ({ epochId }: { epochId: string }) => epochKeys.get(epochId) ?? null,
}));
mock.module("./imageCache.ts", () => ({
  imageFileNameFromUrl: (value: string | null | undefined) => {
    const parsed = imageFileNameSchema.safeParse(value?.split("/").pop());
    return parsed.success ? parsed.data : null;
  },
  cachedImageUri: (fileName: string) => (cached.has(fileName) ? `file:///cache/${fileName}` : null),
  readCachedImage: async (fileName: string) => {
    reads.push(fileName);
    return cached.get(fileName) ?? null;
  },
}));
mock.module("./image-upload.ts", () => ({
  uploadEncryptedImage: async (input: {
    bytes: Uint8Array;
    confirm: (confirm: { fileName: string; imageKey: ImageKeyMaterial }) => Promise<unknown>;
    ownerId: string;
    purpose: string;
    request: () => Promise<{ fileName: string }>;
  }) => {
    uploads.push({ bytes: input.bytes, ownerId: input.ownerId, purpose: input.purpose });
    const { fileName } = await input.request();
    await input.confirm({ fileName, imageKey: generateImageKey() });
    return { fileName, imageUrl: url(fileName) };
  },
}));
mock.module("./imageKeys.ts", () => ({
  confirmGroupImage: async (input: {
    expectedFileName?: string | null;
    fileName: string;
    groupId: string;
  }) => {
    groupConfirms.push({
      expectedFileName: input.expectedFileName,
      fileName: input.fileName,
      groupId: input.groupId,
    });
    if (confirmError) throw confirmError;
    return { imageUrl: url(input.fileName) };
  },
  getOwnImageKey: async (input: { groups?: () => Promise<unknown> }) => {
    ownKeyGroups.push(await input.groups?.());
    return ownKey;
  },
  storeOwnImageKeyInGroup: storeOwn,
}));

const { checkImageKeys, resetImageKeyCheck } = await import("./imageKeySelfCheck.ts");

const user = { id: "user-a", image: url(ME_FILE), imageKeySealed: null };

const makeGroup = ({
  groupKey,
  ownGroupKey,
  role = "EDITOR",
}: {
  groupKey?: EncryptedImageKey | null;
  ownGroupKey?: EncryptedImageKey | null;
  role?: "ADMIN" | "EDITOR" | "MEMBER";
}): Group => ({
  id: groupId,
  name: "Family",
  image: url(GROUP_FILE),
  ownerId: "user-a",
  ownershipOfferedToId: null,
  onHold: false,
  imageKey:
    groupKey === undefined
      ? wrap({
          fileName: GROUP_FILE,
          imageKey: groupPictureKey,
          kind: "group-image-key",
          ownerId: groupId,
        })
      : groupKey,
  members: [
    {
      id: "m-a",
      userId: "user-a",
      name: "Ana",
      image: url(ME_FILE),
      imageKey:
        ownGroupKey === undefined
          ? wrap({
              fileName: ME_FILE,
              imageKey: ownKey!,
              kind: "profile-image-key",
              ownerId: "user-a",
            })
          : ownGroupKey,
      role,
    },
    { id: "m-b", userId: "user-b", name: "Bea", image: null, imageKey: null, role: "ADMIN" },
  ],
});

const check = (groups: Group[], checkUser: Parameters<typeof checkImageKeys>[0]["user"] = user) => {
  lastChecked = groups;
  return checkImageKeys({ groups, user: checkUser });
};

const junkGroupKey = () =>
  wrap({
    fileName: GROUP_FILE,
    imageKey: generateImageKey(),
    kind: "group-image-key",
    ownerId: groupId,
  });

beforeEach(() => {
  groupRuns += 1;
  groupId = `family-${groupRuns}`;
  epochKeys.clear();
  epochKeys.set("epoch-2", generateGroupEpochKey());
  ownKey = generateImageKey();
  const encrypted = encryptImage({
    bytes: plainPicture,
    fileName: GROUP_FILE,
    ownerId: groupId,
    purpose: "group-image",
  });
  groupPictureKey = encrypted.key;
  groupBlob = encrypted.blob;
  cached.clear();
  cached.set(GROUP_FILE, plainPicture);
  downloadFails = false;
  downloadGate = null;
  serverGroups = null;
  lastChecked = [];
  ownKeyGroups.length = 0;
  reads.length = 0;
  storageValues.clear();
  downloads.length = 0;
  uploads.length = 0;
  groupConfirms.length = 0;
  confirmError = null;
  storeOwn.mockClear();
});

test("does nothing when this phone's own key and the group key both decrypt", async () => {
  const groups = [makeGroup({})];
  expect(await check(groups)).toBe(false);
  expect(storeOwn).not.toHaveBeenCalled();
  expect(uploads).toHaveLength(0);
  expect(downloads).toEqual([url(GROUP_FILE)]);

  expect(await check(groups)).toBe(false);
  expect(downloads).toHaveLength(1);
});

test("stores this phone's own key where it's missing, and only there", async () => {
  const other = makeGroup({});
  groupId = `${groupId}-missing`;
  const missing = makeGroup({ ownGroupKey: null, role: "MEMBER" });
  expect(await check([other, missing])).toBe(true);
  expect(storeOwn.mock.calls).toEqual([[missing.id]]);
});

test("repairs this phone's own key when it's been replaced by a different key", async () => {
  const junk = wrap({
    fileName: ME_FILE,
    imageKey: generateImageKey(),
    kind: "profile-image-key",
    ownerId: "user-a",
  });
  expect(await check([makeGroup({ ownGroupKey: junk, role: "MEMBER" })])).toBe(true);
  expect(storeOwn.mock.calls).toEqual([[groupId]]);
});

test("repairs this phone's own key when it no longer decrypts", async () => {
  const wrongBinding = wrap({
    fileName: GROUP_FILE,
    imageKey: ownKey!,
    kind: "profile-image-key",
    ownerId: "user-a",
  });
  expect(await check([makeGroup({ ownGroupKey: wrongBinding, role: "MEMBER" })])).toBe(true);
  expect(storeOwn.mock.calls).toEqual([[groupId]]);
});

test("stores its own key again under the latest epoch when this phone can't read the stored one", async () => {
  epochKeys.set("epoch-before-joining", generateGroupEpochKey());
  const unreadable = wrap({
    epochId: "epoch-before-joining",
    fileName: ME_FILE,
    imageKey: generateImageKey(),
    kind: "profile-image-key",
    ownerId: "user-a",
  });
  epochKeys.delete("epoch-before-joining");
  expect(await check([makeGroup({ ownGroupKey: unreadable, role: "MEMBER" })])).toBe(true);
  expect(storeOwn.mock.calls).toEqual([[groupId]]);
});

test("leaves its own key alone when this phone doesn't hold the key", async () => {
  const group = makeGroup({ role: "MEMBER" });
  ownKey = null;
  expect(await check([group])).toBe(false);
  expect(storeOwn).not.toHaveBeenCalled();
});

test("an admin's phone uploads the cached picture again when the group key was replaced", async () => {
  const junk = wrap({
    fileName: GROUP_FILE,
    imageKey: generateImageKey(),
    kind: "group-image-key",
    ownerId: groupId,
  });
  expect(await check([makeGroup({ groupKey: junk })])).toBe(true);
  expect(uploads).toEqual([{ bytes: plainPicture, ownerId: groupId, purpose: "group-image" }]);
  expect(groupConfirms).toEqual([
    { expectedFileName: GROUP_FILE, fileName: NEW_GROUP_FILE, groupId },
  ]);
});

test("stops repairing when another admin changes the picture before the upload is confirmed", async () => {
  confirmError = Object.assign(new Error("IMAGE_CHANGED"), { data: { reason: "IMAGE_CHANGED" } });
  const groups = [makeGroup({ groupKey: junkGroupKey() })];
  expect(await check(groups)).toBe(false);
  expect(groupConfirms).toEqual([
    { expectedFileName: GROUP_FILE, fileName: NEW_GROUP_FILE, groupId },
  ]);
  expect(await check(groups)).toBe(false);
  expect(uploads).toHaveLength(1);
});

test("an admin's phone repairs a group key that doesn't decrypt without downloading", async () => {
  const wrongOwner = wrap({
    fileName: GROUP_FILE,
    imageKey: groupPictureKey,
    kind: "group-image-key",
    ownerId: "school",
  });
  expect(await check([makeGroup({ groupKey: wrongOwner, role: "ADMIN" })])).toBe(true);
  expect(downloads).toHaveLength(0);
  expect(uploads).toHaveLength(1);
});

test("only Admins and Editors check the group key, and only with the picture cached", async () => {
  const junk = () =>
    wrap({
      fileName: GROUP_FILE,
      imageKey: generateImageKey(),
      kind: "group-image-key",
      ownerId: groupId,
    });
  expect(await check([makeGroup({ groupKey: junk(), role: "MEMBER" })])).toBe(false);
  cached.clear();
  expect(await check([makeGroup({ groupKey: junk() })])).toBe(false);
  expect(downloads).toHaveLength(0);
  expect(uploads).toHaveLength(0);
});

test("waits 15 minutes before checking again after a failure", async () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));
    const junk = wrap({
      fileName: GROUP_FILE,
      imageKey: generateImageKey(),
      kind: "group-image-key",
      ownerId: groupId,
    });
    const groups = [makeGroup({ groupKey: junk })];
    downloadFails = true;
    expect(await check(groups)).toBe(false);
    downloadFails = false;
    jest.setSystemTime(new Date("2026-11-16T10:14:00.000Z"));
    expect(await check(groups)).toBe(false);
    expect(downloads).toHaveLength(1);
    expect(uploads).toHaveLength(0);
    jest.setSystemTime(new Date("2026-11-16T10:15:00.000Z"));
    expect(await check(groups)).toBe(true);
    expect(uploads).toHaveLength(1);

    storeOwn.mockImplementation(async () => false);
    groupId = `${groupId}-store-fails`;
    const missing = [makeGroup({ ownGroupKey: null, role: "MEMBER" })];
    expect(await check(missing)).toBe(false);
    expect(await check(missing)).toBe(false);
    expect(storeOwn).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date("2026-11-16T10:30:00.000Z"));
    expect(await check(missing)).toBe(false);
    expect(storeOwn).toHaveBeenCalledTimes(2);
  } finally {
    storeOwn.mockImplementation(async () => true);
    jest.useRealTimers();
  }
});

test("reads the cached picture only when it's about to upload it", async () => {
  expect(await check([makeGroup({})])).toBe(false);
  expect(reads).toEqual([]);
  expect(await check([makeGroup({ groupKey: junkGroupKey() })])).toBe(true);
  expect(reads).toEqual([GROUP_FILE]);
});

test("repairs a group picture at most once a day, even when junk keys keep coming", async () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));
    expect(await check([makeGroup({ groupKey: junkGroupKey() })])).toBe(true);
    jest.setSystemTime(new Date("2026-11-16T10:30:00.000Z"));
    expect(await check([makeGroup({ groupKey: junkGroupKey() })])).toBe(false);
    jest.setSystemTime(new Date("2026-11-17T09:59:00.000Z"));
    expect(await check([makeGroup({ groupKey: junkGroupKey() })])).toBe(false);
    expect(uploads).toHaveLength(1);
    expect(downloads).toHaveLength(1);
    jest.setSystemTime(new Date("2026-11-17T10:00:00.000Z"));
    expect(await check([makeGroup({ groupKey: junkGroupKey() })])).toBe(true);
    expect(uploads).toHaveLength(2);
  } finally {
    jest.useRealTimers();
  }
});

test("doesn't upload when the picture changed or this person stopped being an admin", async () => {
  const groups = [makeGroup({ groupKey: junkGroupKey() })];
  serverGroups = [{ ...groups[0]!, imageKey: junkGroupKey() }];
  expect(await check(groups)).toBe(false);

  groupId = `${groupId}-replaced`;
  const replaced = [makeGroup({ groupKey: junkGroupKey() })];
  serverGroups = [{ ...replaced[0]!, image: url(NEW_GROUP_FILE) }];
  expect(await check(replaced)).toBe(false);

  groupId = `${groupId}-demoted`;
  const demoted = [makeGroup({ groupKey: junkGroupKey() })];
  serverGroups = [
    {
      ...demoted[0]!,
      members: demoted[0]!.members.map((member) => ({ ...member, role: "MEMBER" as const })),
    },
  ];
  expect(await check(demoted)).toBe(false);

  groupId = `${groupId}-left`;
  serverGroups = [];
  expect(await check([makeGroup({ groupKey: junkGroupKey() })])).toBe(false);
  expect(uploads).toHaveLength(0);
  expect(reads).toHaveLength(0);
});

const freshImport = (name: string): Promise<typeof import("./imageKeySelfCheck.ts")> =>
  import(`./imageKeySelfCheck.ts?${name}`);

test("remembers settled checks across restarts", async () => {
  const groups = [makeGroup({})];
  expect(await check(groups)).toBe(false);
  expect(downloads).toHaveLength(1);
  const restarted = await freshImport("restart");
  expect(await restarted.checkImageKeys({ groups, user })).toBe(false);
  expect(downloads).toHaveLength(1);

  storageValues.clear();
  const wiped = await freshImport("wiped");
  expect(await wiped.checkImageKeys({ groups, user })).toBe(false);
  expect(downloads).toHaveLength(2);
});

const holdDownloads = () => {
  let release = () => {};
  downloadGate = new Promise((resolve) => {
    release = resolve;
  });
  return release;
};

const downloadStarted = async () => {
  while (downloads.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
};

test("checks the newest groups once a running check finishes", async () => {
  const release = holdDownloads();
  const first = check([makeGroup({})]);
  await downloadStarted();
  const original = groupId;
  groupId = `${original}-superseded`;
  const second = check([makeGroup({ ownGroupKey: null, role: "MEMBER" })]);
  groupId = `${original}-latest`;
  const third = check([makeGroup({ ownGroupKey: null, role: "MEMBER" })]);
  release();
  expect(await Promise.all([first, second, third])).toEqual([true, true, true]);
  expect(downloads).toHaveLength(1);
  expect(storeOwn.mock.calls).toEqual([[`${original}-latest`]]);
});

test("stops checking for a person who signed out mid-check", async () => {
  const release = holdDownloads();
  const firstGroup = makeGroup({});
  groupId = `${groupId}-second`;
  const secondGroup = makeGroup({ ownGroupKey: null, role: "MEMBER" });
  const running = check([firstGroup, secondGroup]);
  await downloadStarted();
  const other = check([], { id: "user-z", image: null, imageKeySealed: null });
  release();
  expect(await Promise.all([running, other])).toEqual([false, false]);
  expect(downloads).toHaveLength(1);
  expect(storeOwn).not.toHaveBeenCalled();
});

test("stops checking when this person signs out mid-check", async () => {
  const release = holdDownloads();
  const firstGroup = makeGroup({});
  groupId = `${groupId}-second`;
  const secondGroup = makeGroup({ ownGroupKey: null, role: "MEMBER" });
  const running = check([firstGroup, secondGroup]);
  await downloadStarted();
  resetImageKeyCheck();
  release();
  expect(await running).toBe(false);
  expect(downloads).toHaveLength(1);
  expect(storeOwn).not.toHaveBeenCalled();
});

test("signing out forgets recent attempts, so the next account's check runs straight away", async () => {
  ownKey = null;
  const group = makeGroup({ ownGroupKey: null, role: "MEMBER" });
  await check([group]);
  await check([group]);
  expect(ownKeyGroups).toHaveLength(1);
  resetImageKeyCheck();
  await check([group]);
  expect(ownKeyGroups).toHaveLength(2);
});

test("looks for this person's own key in the groups being checked", async () => {
  const groups = [makeGroup({ ownGroupKey: null, role: "MEMBER" })];
  await check(groups);
  expect(ownKeyGroups).toEqual([groups]);
});
