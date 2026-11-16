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
  members: {
    id: string;
    userId: string;
    name: string;
    image: string | null;
    imageKey: EncryptedImageKey | null;
    role: "OWNER" | "ADMIN" | "MEMBER";
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
const downloads: string[] = [];
const uploads: { bytes: Uint8Array; ownerId: string; purpose: string }[] = [];
const groupConfirms: { fileName: string; groupId: string }[] = [];
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

mock.module("./api.ts", () => ({
  trpcClient: {
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
  readCachedImage: async (fileName: string) => cached.get(fileName) ?? null,
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
  confirmGroupImage: async (input: { fileName: string; groupId: string }) => {
    groupConfirms.push({ fileName: input.fileName, groupId: input.groupId });
    return { imageUrl: url(input.fileName) };
  },
  getOwnImageKey: async () => ownKey,
  storeOwnImageKeyInGroup: storeOwn,
}));

const { checkImageKeys } = await import("./imageKeySelfCheck.ts");

const user = { id: "user-a", image: url(ME_FILE), imageKeySealed: null };

const makeGroup = ({
  groupKey,
  ownGroupKey,
  role = "ADMIN",
}: {
  groupKey?: EncryptedImageKey | null;
  ownGroupKey?: EncryptedImageKey | null;
  role?: "OWNER" | "ADMIN" | "MEMBER";
}): Group => ({
  id: groupId,
  name: "Family",
  image: url(GROUP_FILE),
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
    { id: "m-b", userId: "user-b", name: "Bea", image: null, imageKey: null, role: "OWNER" },
  ],
});

const check = (groups: Group[]) => checkImageKeys({ groups, user });

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
  downloads.length = 0;
  uploads.length = 0;
  groupConfirms.length = 0;
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

test("leaves its own key alone when this phone can't read its epoch or doesn't hold the key", async () => {
  epochKeys.set("epoch-before-joining", generateGroupEpochKey());
  const unreadable = wrap({
    epochId: "epoch-before-joining",
    fileName: ME_FILE,
    imageKey: generateImageKey(),
    kind: "profile-image-key",
    ownerId: "user-a",
  });
  epochKeys.delete("epoch-before-joining");
  expect(await check([makeGroup({ ownGroupKey: unreadable, role: "MEMBER" })])).toBe(false);

  groupId = `${groupId}-no-own-key`;
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
  expect(groupConfirms).toEqual([{ fileName: NEW_GROUP_FILE, groupId }]);
});

test("an admin's phone repairs a group key that doesn't decrypt without downloading", async () => {
  const wrongOwner = wrap({
    fileName: GROUP_FILE,
    imageKey: groupPictureKey,
    kind: "group-image-key",
    ownerId: "school",
  });
  expect(await check([makeGroup({ groupKey: wrongOwner, role: "OWNER" })])).toBe(true);
  expect(downloads).toHaveLength(0);
  expect(uploads).toHaveLength(1);
});

test("only owners and admins check the group key, and only with the picture cached", async () => {
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
