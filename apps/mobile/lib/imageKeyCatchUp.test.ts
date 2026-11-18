import { beforeEach, expect, mock, test } from "bun:test";
import {
  decryptImageKey,
  type EncryptedImageKey,
  encryptImageKey,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  generateImageKey,
  type ImageKeyKind,
  type ImageKeyMaterial,
} from "@openbeacon/encryption";

const GROUP_FILE = "11111111-1111-4111-8111-111111111111";
const ME_FILE = "22222222-2222-4222-8222-222222222222";
const BEA_FILE = "33333333-3333-4333-8333-333333333333";
const CAL_FILE = "44444444-4444-4444-8444-444444444444";
const OTHER_FILE = "55555555-5555-4555-8555-555555555555";

const url = (fileName: string) => `https://images.example.test/${fileName}`;

type Member = {
  id: string;
  userId: string;
  name: string;
  role: "ADMIN" | "EDITOR" | "MEMBER";
  image: string | null;
  imageKey: EncryptedImageKey | null;
};
type Group = {
  id: string;
  name: string;
  image: string | null;
  imageKey: EncryptedImageKey | null;
  ownerId: string;
  ownershipOfferedToId: string | null;
  onHold: boolean;
  members: Member[];
};
type ReEncryptInput = {
  groupId: string;
  keys: {
    target: { kind: "group" } | { kind: "member"; memberId: string };
    fileName: string;
    expectedCiphertext: string;
    key: EncryptedImageKey;
  }[];
};

const epochKeys = new Map<string, EpochKeyMaterial>();
const pictureKeys = new Map<string, ImageKeyMaterial>();
let group: Group;
let latestEpochId = "epoch-2";
let failures: unknown[] = [];
let beforeReEncrypt: (() => void) | null = null;
let listCalls = 0;
const resolvedEpochs: string[] = [];
const reEncryptCalls: ReEncryptInput[] = [];
const rotate = mock(async (_groupId: string) => true);
const relink = mock(async (_options?: { linkSession?: boolean }) => device);
const storeOwn = mock(async (_groupId: string) => true);
const device = { deviceId: "device-a", userId: "user-a" };

const reasonError = (reason: string) => Object.assign(new Error(reason), { data: { reason } });

const once = (change: () => void) => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    change();
  };
};

const wrap = ({
  epochId,
  fileName,
  imageKey,
  kind,
  ownerId,
}: {
  epochId: string;
  fileName: string;
  imageKey: ImageKeyMaterial;
  kind: ImageKeyKind;
  ownerId: string;
}) =>
  encryptImageKey({
    epochId,
    epochKey: epochKeys.get(epochId)!,
    fileName,
    groupId: "family",
    imageKey,
    kind,
    ownerId,
    senderDeviceId: "device-admin",
  });

const memberKey = (userId: string, fileName: string, epochId: string) =>
  wrap({
    epochId,
    fileName,
    imageKey: pictureKeys.get(userId)!,
    kind: "profile-image-key",
    ownerId: userId,
  });

const groupKey = (epochId: string) =>
  wrap({
    epochId,
    fileName: GROUP_FILE,
    imageKey: pictureKeys.get("family")!,
    kind: "group-image-key",
    ownerId: "family",
  });

const member = (id: string) => group.members.find((item) => item.id === id)!;

const reEncrypt = async (input: ReEncryptInput) => {
  reEncryptCalls.push(structuredClone(input));
  beforeReEncrypt?.();
  const failure = failures.shift();
  if (failure) throw failure;
  if (input.keys.some(({ key }) => key.epochId !== latestEpochId)) {
    throw reasonError("EPOCH_NOT_LATEST");
  }
  const result = {
    reEncrypted: [] as ReEncryptInput["keys"][number]["target"][],
    skipped: [] as ReEncryptInput["keys"][number]["target"][],
    changed: [] as ReEncryptInput["keys"][number]["target"][],
    gone: [] as ReEncryptInput["keys"][number]["target"][],
  };
  for (const request of input.keys) {
    const holder =
      request.target.kind === "group"
        ? group
        : group.members.find(
            ({ id }) => request.target.kind === "member" && id === request.target.memberId,
          );
    if (!holder?.image || !holder.imageKey) result.gone.push(request.target);
    else if (
      holder.imageKey.ciphertext !== request.expectedCiphertext ||
      holder.image !== url(request.fileName)
    ) {
      result.changed.push(request.target);
    } else if (holder.imageKey.epochId === request.key.epochId) result.skipped.push(request.target);
    else {
      holder.imageKey = request.key;
      result.reEncrypted.push(request.target);
    }
  }
  return result;
};

mock.module("./api.ts", () => ({
  trpcClient: {
    groupMembership: {
      list: {
        query: async () => {
          listCalls += 1;
          return [structuredClone(group)];
        },
      },
    },
    groupEpoch: { getLatest: { query: async () => ({ epochId: latestEpochId }) } },
    groupImageKeys: { reEncrypt: { mutate: reEncrypt } },
  },
}));
mock.module("./deviceKeys.ts", () => ({ ensureDeviceKeyRegistration: relink }));
mock.module("./epochKeys.ts", () => ({
  resolveEpochKey: async ({ epochId }: { epochId: string }) => {
    resolvedEpochs.push(epochId);
    return epochId === "epoch-before-joining" ? null : (epochKeys.get(epochId) ?? null);
  },
}));
mock.module("./groupEncryption.ts", () => ({ rotateGroupEpochIfRequired: rotate }));
mock.module("./imageKeys.ts", () => ({ storeOwnImageKeyInGroup: storeOwn }));
mock.module("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));

const { catchUpGroupImageKeys } = await import("./imageKeyCatchUp.ts");

const family = { groupId: "family", userId: "user-a" };

const open = ({
  encryptedKey,
  epochId,
  fileName,
  kind,
  ownerId,
}: {
  encryptedKey: EncryptedImageKey;
  epochId: string;
  fileName: string;
  kind: ImageKeyKind;
  ownerId: string;
}) => {
  try {
    return decryptImageKey({
      encryptedKey,
      epochKey: epochKeys.get(epochId)!,
      fileName,
      groupId: "family",
      kind,
      ownerId,
    }).expose();
  } catch {
    return null;
  }
};

beforeEach(() => {
  epochKeys.clear();
  for (const epochId of ["epoch-1", "epoch-2", "epoch-3", "epoch-before-joining"]) {
    epochKeys.set(epochId, generateGroupEpochKey());
  }
  pictureKeys.clear();
  for (const owner of ["family", "user-a", "user-b", "user-c"]) {
    pictureKeys.set(owner, generateImageKey());
  }
  latestEpochId = "epoch-2";
  group = {
    id: "family",
    name: "Family",
    image: url(GROUP_FILE),
    ownerId: "user-d",
    ownershipOfferedToId: null,
    onHold: false,
    imageKey: groupKey("epoch-1"),
    members: [
      {
        id: "m-a",
        userId: "user-a",
        name: "Ana",
        role: "EDITOR",
        image: url(ME_FILE),
        imageKey: memberKey("user-a", ME_FILE, "epoch-2"),
      },
      {
        id: "m-b",
        userId: "user-b",
        name: "Bea",
        role: "MEMBER",
        image: url(BEA_FILE),
        imageKey: memberKey("user-b", BEA_FILE, "epoch-1"),
      },
      {
        id: "m-c",
        userId: "user-c",
        name: "Cal",
        role: "MEMBER",
        image: url(CAL_FILE),
        imageKey: memberKey("user-c", CAL_FILE, "epoch-before-joining"),
      },
      { id: "m-d", userId: "user-d", name: "Dev", role: "ADMIN", image: null, imageKey: null },
    ],
  };
  failures = [];
  beforeReEncrypt = null;
  listCalls = 0;
  resolvedEpochs.length = 0;
  reEncryptCalls.length = 0;
  rotate.mockClear();
  relink.mockClear();
  storeOwn.mockClear();
});

test("re-wraps the stale keys this phone can read under the latest epoch, with the same binding", async () => {
  expect(await catchUpGroupImageKeys(family)).toBe(2);

  expect(group.imageKey?.epochId).toBe("epoch-2");
  expect(group.imageKey?.senderDeviceId).toBe("device-a");
  expect(
    open({
      encryptedKey: group.imageKey!,
      epochId: "epoch-2",
      fileName: GROUP_FILE,
      kind: "group-image-key",
      ownerId: "family",
    }),
  ).toEqual(pictureKeys.get("family")!.expose());
  const bea = member("m-b").imageKey!;
  expect(bea.epochId).toBe("epoch-2");
  expect(
    open({
      encryptedKey: bea,
      epochId: "epoch-2",
      fileName: BEA_FILE,
      kind: "profile-image-key",
      ownerId: "user-b",
    }),
  ).toEqual(pictureKeys.get("user-b")!.expose());
});

test("binds each new wrap to its kind, owner, file name and group", async () => {
  await catchUpGroupImageKeys(family);
  const bea = member("m-b").imageKey!;
  const right = {
    encryptedKey: bea,
    epochId: "epoch-2",
    fileName: BEA_FILE,
    kind: "profile-image-key" as const,
    ownerId: "user-b",
  };
  expect(open(right)).not.toBeNull();
  expect(open({ ...right, kind: "group-image-key" })).toBeNull();
  expect(open({ ...right, ownerId: "user-a" })).toBeNull();
  expect(open({ ...right, fileName: OTHER_FILE })).toBeNull();
  expect(open({ ...right, epochId: "epoch-1" })).toBeNull();
  expect(() =>
    decryptImageKey({
      encryptedKey: bea,
      epochKey: epochKeys.get("epoch-2")!,
      fileName: BEA_FILE,
      groupId: "school",
      kind: "profile-image-key",
      ownerId: "user-b",
    }),
  ).toThrow();
});

test("sends only readable stale keys, each against the ciphertext it read", async () => {
  const before = structuredClone(group);
  await catchUpGroupImageKeys(family);

  expect(reEncryptCalls).toHaveLength(1);
  const sent = reEncryptCalls[0]!.keys;
  expect(sent.map(({ target }) => target)).toEqual([
    { kind: "group" },
    { kind: "member", memberId: "m-b" },
  ]);
  expect(sent.map(({ fileName }) => fileName)).toEqual([GROUP_FILE, BEA_FILE]);
  expect(sent[0]!.expectedCiphertext).toBe(before.imageKey!.ciphertext);
  expect(sent[1]!.expectedCiphertext).toBe(before.members[1]!.imageKey!.ciphertext);
  expect(member("m-a").imageKey).toEqual(before.members[0]!.imageKey);
  expect(member("m-c").imageKey).toEqual(before.members[2]!.imageKey);
});

test("leaves keys this phone can't read alone, including ones that don't decrypt", async () => {
  group.imageKey = wrap({
    epochId: "epoch-1",
    fileName: OTHER_FILE,
    imageKey: pictureKeys.get("family")!,
    kind: "group-image-key",
    ownerId: "family",
  });
  member("m-b").imageKey = memberKey("user-c", BEA_FILE, "epoch-1");
  const before = structuredClone(group);
  expect(await catchUpGroupImageKeys(family)).toBe(0);
  expect(reEncryptCalls).toHaveLength(0);
  expect(group).toEqual(before);
});

test("does nothing when every key is current or unreadable, or the group has no epoch", async () => {
  group.imageKey = groupKey("epoch-2");
  member("m-b").imageKey = memberKey("user-b", BEA_FILE, "epoch-2");
  expect(await catchUpGroupImageKeys(family)).toBe(0);
  expect(reEncryptCalls).toHaveLength(0);
});

test("refetches and retries once when a key changed, then stops", async () => {
  beforeReEncrypt = once(() => {
    pictureKeys.set("user-b", generateImageKey());
    member("m-b").imageKey = memberKey("user-b", BEA_FILE, "epoch-1");
  });
  expect(await catchUpGroupImageKeys(family)).toBe(2);
  expect(listCalls).toBe(2);
  expect(reEncryptCalls.map(({ keys }) => keys.map(({ target }) => target))).toEqual([
    [{ kind: "group" }, { kind: "member", memberId: "m-b" }],
    [{ kind: "member", memberId: "m-b" }],
  ]);
  expect(
    open({
      encryptedKey: member("m-b").imageKey!,
      epochId: "epoch-2",
      fileName: BEA_FILE,
      kind: "profile-image-key",
      ownerId: "user-b",
    }),
  ).toEqual(pictureKeys.get("user-b")!.expose());

  reEncryptCalls.length = 0;
  listCalls = 0;
  group.imageKey = groupKey("epoch-1");
  beforeReEncrypt = () => {
    group.imageKey = groupKey("epoch-1");
  };
  expect(await catchUpGroupImageKeys(family)).toBe(0);
  expect(reEncryptCalls).toHaveLength(2);
  expect(listCalls).toBe(2);
});

test("a picture replaced during catch-up counts as changed and is retried with the new file", async () => {
  beforeReEncrypt = once(() => {
    member("m-b").image = url(OTHER_FILE);
    member("m-b").imageKey = memberKey("user-b", OTHER_FILE, "epoch-1");
  });
  expect(await catchUpGroupImageKeys(family)).toBe(2);
  expect(reEncryptCalls[1]!.keys[0]!.fileName).toBe(OTHER_FILE);
});

test("gone and skipped results need no retry", async () => {
  beforeReEncrypt = () => {
    member("m-b").image = null;
    member("m-b").imageKey = null;
    group.imageKey = { ...group.imageKey!, epochId: "epoch-2" };
  };
  expect(await catchUpGroupImageKeys(family)).toBe(0);
  expect(reEncryptCalls).toHaveLength(1);
  expect(listCalls).toBe(1);
  expect(group.imageKey?.senderDeviceId).toBe("device-admin");
});

test("runs a pending key rotation, then retries once on the new epoch", async () => {
  failures = [reasonError("EPOCH_ROTATION_PENDING")];
  rotate.mockImplementationOnce(async () => {
    latestEpochId = "epoch-3";
    return true;
  });
  expect(await catchUpGroupImageKeys(family)).toBe(3);
  expect(rotate).toHaveBeenCalledWith("family");
  expect(reEncryptCalls[1]!.keys.map(({ key }) => key.epochId)).toEqual([
    "epoch-3",
    "epoch-3",
    "epoch-3",
  ]);
  expect(member("m-a").imageKey?.epochId).toBe("epoch-3");
});

test("refreshes the latest epoch once on EPOCH_NOT_LATEST, then gives up", async () => {
  beforeReEncrypt = once(() => {
    latestEpochId = "epoch-3";
  });
  expect(await catchUpGroupImageKeys(family)).toBe(3);
  expect(rotate).not.toHaveBeenCalled();
  expect(reEncryptCalls).toHaveLength(2);

  reEncryptCalls.length = 0;
  group.imageKey = groupKey("epoch-1");
  failures = [reasonError("EPOCH_NOT_LATEST"), reasonError("EPOCH_NOT_LATEST")];
  await expect(catchUpGroupImageKeys(family)).rejects.toThrow("EPOCH_NOT_LATEST");
  expect(reEncryptCalls).toHaveLength(2);

  reEncryptCalls.length = 0;
  failures = [reasonError("NOT_GROUP_MEMBER")];
  await expect(catchUpGroupImageKeys(family)).rejects.toThrow("NOT_GROUP_MEMBER");
  expect(reEncryptCalls).toHaveLength(1);
});

test("registers the device again once when the server doesn't know it", async () => {
  failures = [reasonError("DEVICE_NOT_REGISTERED")];
  expect(await catchUpGroupImageKeys(family)).toBe(2);
  expect(relink).toHaveBeenCalledWith({ linkSession: true });
  expect(reEncryptCalls).toHaveLength(2);
});

test("stores this phone's own key when it's missing from the group, and only then", async () => {
  await catchUpGroupImageKeys(family);
  expect(storeOwn).not.toHaveBeenCalled();

  member("m-a").imageKey = null;
  expect(await catchUpGroupImageKeys(family)).toBe(1);
  expect(storeOwn).toHaveBeenCalledWith("family");

  storeOwn.mockClear();
  storeOwn.mockImplementationOnce(async () => {
    throw new Error("offline");
  });
  group.imageKey = groupKey("epoch-1");
  expect(await catchUpGroupImageKeys(family)).toBe(1);
});

test("shares one run between callers for the same person and group", async () => {
  const [first, second] = await Promise.all([
    catchUpGroupImageKeys(family),
    catchUpGroupImageKeys(family),
  ]);
  expect([first, second]).toEqual([2, 2]);
  expect(reEncryptCalls).toHaveLength(1);
});

test("doesn't fetch the latest epoch key when no stale key is readable", async () => {
  group.imageKey = groupKey("epoch-2");
  member("m-b").imageKey = memberKey("user-b", BEA_FILE, "epoch-2");
  expect(await catchUpGroupImageKeys(family)).toBe(0);
  expect(resolvedEpochs).toEqual(["epoch-before-joining"]);
  expect(reEncryptCalls).toHaveLength(0);
});

test("uses a given group list for the first pass and refetches only to retry", async () => {
  let given = 0;
  const groups = async () => {
    given += 1;
    return [structuredClone(group)];
  };
  expect(await catchUpGroupImageKeys({ ...family, groups })).toBe(2);
  expect([given, listCalls]).toEqual([1, 0]);

  group.imageKey = groupKey("epoch-1");
  beforeReEncrypt = once(() => {
    group.imageKey = groupKey("epoch-1");
  });
  expect(await catchUpGroupImageKeys({ ...family, groups })).toBe(1);
  expect([given, listCalls]).toEqual([2, 1]);

  group.imageKey = groupKey("epoch-1");
  failures = [reasonError("EPOCH_NOT_LATEST")];
  expect(await catchUpGroupImageKeys({ ...family, groups })).toBe(1);
  expect([given, listCalls]).toEqual([3, 2]);
});

test("after an error retry it still stores a missing own key and retries a changed key once", async () => {
  member("m-a").imageKey = null;
  failures = [reasonError("DEVICE_NOT_REGISTERED")];
  beforeReEncrypt = () => {
    if (reEncryptCalls.length === 2) {
      pictureKeys.set("user-b", generateImageKey());
      member("m-b").imageKey = memberKey("user-b", BEA_FILE, "epoch-1");
    }
  };
  expect(await catchUpGroupImageKeys(family)).toBe(3);
  expect(storeOwn).toHaveBeenCalledWith("family");
  expect(reEncryptCalls).toHaveLength(3);
  expect(listCalls).toBe(3);
  expect(member("m-b").imageKey?.epochId).toBe("epoch-2");
});
