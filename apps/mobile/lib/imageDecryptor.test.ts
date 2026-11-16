import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  encryptImage,
  encryptImageKey,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  type ImageKeyKind,
  type ImageKeyMaterial,
  type ImagePurpose,
} from "@openbeacon/encryption";

mock.module("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));
mock.module("./storage.ts", () => ({ storage: {} }));
mock.module("./currentServer.ts", () => ({ baseUrl: "https://api.example" }));

const { createImageDecryptor, ImageGoneError, imageKeySources } =
  await import("./imageDecryptor.ts");

const alice = "user-alice";
const bob = "user-bob";
const groupId = "group-1";
const fileA = "0d6c8c2e-2b1a-4c55-9a4e-6f1b2f3c4d5e";
const fileB = "7f0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b";
const urlFor = (fileName: string) => `https://cdn.example/images/profile/${fileName}`;
const picture = new Uint8Array(Array.from({ length: 200 }, (_, index) => (index * 13) % 256));
const otherPicture = new Uint8Array(Array.from({ length: 200 }, (_, index) => (index * 5) % 256));

const epochKeys = new Map<string, EpochKeyMaterial | null>();
const served = new Map<string, Uint8Array>();
const cache = new Map<string, Uint8Array>();
const ownKeys = new Map<string, ImageKeyMaterial>();
let downloads: string[] = [];
let epochKeyRequests: string[] = [];
let ownKeyRequests: { fileName: string; sealed: string | null; userId: string }[] = [];
let downloadGate: Promise<void> | null = null;
let downloadError: Error | null = null;
let generation = 0;
let now = 0;

const encrypt = ({
  bytes = picture,
  fileName,
  ownerId,
  purpose,
}: {
  bytes?: Uint8Array;
  fileName: string;
  ownerId: string;
  purpose: ImagePurpose;
}) => {
  const { blob, key } = encryptImage({ bytes, fileName, ownerId, purpose });
  served.set(urlFor(fileName), blob);
  return key;
};

const wrap = ({
  epochId = "epoch-1",
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
}) => {
  const epochKey = epochKeys.get(`${groupId}:${epochId}`) ?? generateGroupEpochKey();
  return encryptImageKey({
    epochId,
    epochKey,
    fileName,
    groupId,
    imageKey,
    kind,
    ownerId,
    senderDeviceId: "device-1",
  });
};

const memberSource = (imageKey: ReturnType<typeof wrap>, userId = bob) =>
  ({ kind: "member", groupId, imageKey, userId }) as const;

const createDecryptor = () =>
  createImageDecryptor({
    cachedUri: (fileName) => (cache.has(fileName) ? `file:///cache/images/${fileName}` : null),
    download: async (url) => {
      downloads.push(url);
      await downloadGate;
      if (downloadError) throw downloadError;
      const blob = served.get(url);
      if (!blob) throw new Error("Not found");
      return blob;
    },
    generation: () => generation,
    getOwnImageKey: async (input) => {
      ownKeyRequests.push(input);
      return ownKeys.get(input.fileName) ?? null;
    },
    now: () => now,
    resolveEpochKey: async ({ epochId, groupId: group }) => {
      epochKeyRequests.push(`${group}:${epochId}`);
      return epochKeys.get(`${group}:${epochId}`) ?? null;
    },
    writeCached: ({ bytes, fileName, forGeneration }) => {
      if (forGeneration !== generation) return null;
      cache.set(fileName, bytes);
      return `file:///cache/images/${fileName}`;
    },
  });

beforeEach(() => {
  epochKeys.clear();
  served.clear();
  cache.clear();
  ownKeys.clear();
  downloads = [];
  epochKeyRequests = [];
  ownKeyRequests = [];
  downloadGate = null;
  downloadError = null;
  generation = 0;
  now = 0;
  epochKeys.set(`${groupId}:epoch-1`, generateGroupEpochKey());
});

describe("loading a picture", () => {
  test("a cached picture is shown without downloading or finding a key", async () => {
    cache.set(fileA, picture);

    const result = await createDecryptor().load({ sources: [], url: urlFor(fileA) });

    expect(result).toEqual({ status: "ready", uri: `file:///cache/images/${fileA}` });
    expect(downloads).toEqual([]);
    expect(epochKeyRequests).toEqual([]);
  });

  test("a member's picture is downloaded, decrypted with their key and cached", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });

    const result = await createDecryptor().load({
      sources: [memberSource(key)],
      url: urlFor(fileA),
    });

    expect(result).toEqual({ status: "ready", uri: `file:///cache/images/${fileA}` });
    expect(cache.get(fileA)).toEqual(picture);
    expect(downloads).toEqual([urlFor(fileA)]);
  });

  test("a group picture is decrypted with the group's key", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: groupId, purpose: "group-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "group-image-key", ownerId: groupId });

    const result = await createDecryptor().load({
      sources: [{ kind: "group", groupId, imageKey: key }],
      url: urlFor(fileA),
    });

    expect(result.status).toBe("ready");
    expect(cache.get(fileA)).toEqual(picture);
  });

  test("a key stored for a different person doesn't decrypt", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });

    const result = await createDecryptor().load({
      sources: [memberSource(key, alice)],
      url: urlFor(fileA),
    });

    expect(result).toEqual({ status: "undecryptable" });
    expect(cache.size).toBe(0);
  });

  test("a key stored for another file doesn't decrypt this one", async () => {
    const keyA = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    encrypt({ fileName: fileB, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey: keyA, kind: "profile-image-key", ownerId: bob });

    const result = await createDecryptor().load({
      sources: [memberSource(key)],
      url: urlFor(fileB),
    });

    expect(result).toEqual({ status: "undecryptable" });
    expect(cache.size).toBe(0);
  });

  test("another file served under this name is never shown", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    const swapped = encryptImage({
      bytes: otherPicture,
      fileName: fileB,
      ownerId: bob,
      purpose: "profile-image",
    });
    served.set(urlFor(fileA), swapped.blob);

    const result = await createDecryptor().load({
      sources: [memberSource(key)],
      url: urlFor(fileA),
    });

    expect(result).toEqual({ status: "undecryptable" });
    expect(cache.size).toBe(0);
  });

  test("a profile key passed off as the group's key doesn't decrypt", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: groupId, purpose: "group-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: groupId });

    const result = await createDecryptor().load({
      sources: [{ kind: "group", groupId, imageKey: key }],
      url: urlFor(fileA),
    });

    expect(result).toEqual({ status: "undecryptable" });
  });

  test("a group key used for a profile picture doesn't decrypt", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: groupId, purpose: "group-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "group-image-key", ownerId: groupId });

    const result = await createDecryptor().load({
      sources: [memberSource(key, groupId)],
      url: urlFor(fileA),
    });

    expect(result).toEqual({ status: "undecryptable" });
  });
});

describe("your own picture", () => {
  test("uses the key this phone holds, passing the sealed copy along", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: alice, purpose: "profile-image" });
    ownKeys.set(fileA, imageKey);

    const result = await createDecryptor().load({
      sources: [{ kind: "own", sealed: "sealed-copy", userId: alice }],
      url: urlFor(fileA),
    });

    expect(result.status).toBe("ready");
    expect(ownKeyRequests).toEqual([{ fileName: fileA, sealed: "sealed-copy", userId: alice }]);
    expect(epochKeyRequests).toEqual([]);
  });

  test("falls back to your key in a group when this phone can't find its own", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: alice, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: alice });

    const result = await createDecryptor().load({
      sources: [{ kind: "own", sealed: null, userId: alice }, memberSource(key, alice)],
      url: urlFor(fileA),
    });

    expect(result.status).toBe("ready");
    expect(ownKeyRequests).toHaveLength(1);
  });
});

describe("requests", () => {
  test("loads at the same time share one download and one key lookup", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    let release = () => {};
    downloadGate = new Promise((resolve) => {
      release = resolve;
    });
    const decryptor = createDecryptor();

    const loads = [1, 2, 3].map(() =>
      decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) }),
    );
    await Promise.resolve();
    release();
    const results = await Promise.all(loads);

    expect(results.map((result) => result.status)).toEqual(["ready", "ready", "ready"]);
    expect(downloads).toHaveLength(1);
    expect(epochKeyRequests).toHaveLength(1);
  });

  test("a picture that won't decrypt isn't downloaded again", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    served.set(
      urlFor(fileA),
      encryptImage({ bytes: otherPicture, fileName: fileB, ownerId: bob, purpose: "profile-image" })
        .blob,
    );
    const decryptor = createDecryptor();

    await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });
    now = 10 * 60_000;
    const again = await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });

    expect(again).toEqual({ status: "undecryptable" });
    expect(downloads).toHaveLength(1);
  });

  test("a new key for the same picture is tried straight away", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const stale = wrap({
      epochId: "epoch-0",
      fileName: fileA,
      imageKey,
      kind: "profile-image-key",
      ownerId: bob,
    });
    const decryptor = createDecryptor();

    const first = await decryptor.load({ sources: [memberSource(stale)], url: urlFor(fileA) });
    const fresh = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    const second = await decryptor.load({ sources: [memberSource(fresh)], url: urlFor(fileA) });

    expect(first).toEqual({ status: "stale-key" });
    expect(second.status).toBe("ready");
  });

  test("a failed download is retried after a minute, not before", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    const decryptor = createDecryptor();
    downloadError = new Error("offline");

    const first = await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });
    downloadError = null;
    const soon = await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });
    now = 61_000;
    const later = await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });

    expect(first).toEqual({ status: "unavailable" });
    expect(soon).toEqual({ status: "unavailable" });
    expect(later.status).toBe("ready");
    expect(downloads).toHaveLength(2);
  });

  test("a picture gone from storage isn't downloaded again until its keys change", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    const decryptor = createDecryptor();
    downloadError = new ImageGoneError("Picture download failed with 404.");

    const first = await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });
    now = 10 * 60_000;
    const later = await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });
    downloadError = null;
    const fresh = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    const rekeyed = await decryptor.load({ sources: [memberSource(fresh)], url: urlFor(fileA) });

    expect(first).toEqual({ status: "gone" });
    expect(later).toEqual({ status: "gone" });
    expect(rekeyed.status).toBe("ready");
    expect(downloads).toHaveLength(2);
  });

  test("a picture finishing after sign-out isn't written to the cache", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    let release = () => {};
    downloadGate = new Promise((resolve) => {
      release = resolve;
    });

    const loading = createDecryptor().load({ sources: [memberSource(key)], url: urlFor(fileA) });
    while (downloads.length === 0) await Bun.sleep(1);
    generation += 1;
    release();

    expect(await loading).toEqual({ status: "unavailable" });
    expect(cache.size).toBe(0);
  });
});

describe("without a key", () => {
  test("no key shows initials without downloading", async () => {
    encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });

    const result = await createDecryptor().load({ sources: [], url: urlFor(fileA) });

    expect(result).toEqual({ status: "no-key" });
    expect(downloads).toEqual([]);
  });

  test("your own picture with no key on this phone or sealed copy shows initials", async () => {
    const result = await createDecryptor().load({
      sources: [{ kind: "own", sealed: null, userId: alice }],
      url: urlFor(fileA),
    });

    expect(result).toEqual({ status: "no-key" });
    expect(downloads).toEqual([]);
  });

  test("a key under an epoch this phone can't read is reported as stale", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({
      epochId: "epoch-0",
      fileName: fileA,
      imageKey,
      kind: "profile-image-key",
      ownerId: bob,
    });

    const result = await createDecryptor().load({
      sources: [memberSource(key)],
      url: urlFor(fileA),
    });

    expect(result).toEqual({ status: "stale-key" });
    expect(downloads).toEqual([]);
  });

  test("no picture or a malformed address shows initials", async () => {
    const decryptor = createDecryptor();

    expect(await decryptor.load({ sources: [], url: null })).toEqual({ status: "no-picture" });
    expect(
      await decryptor.load({ sources: [], url: "https://cdn.example/images/../secret" }),
    ).toEqual({ status: "no-picture" });
  });
});

describe("finding keys for a picture", () => {
  const stored = {
    algorithm: "XChaCha20-Poly1305",
    ciphertext: "stored",
    epochId: "epoch-1",
    nonce: "nonce",
    senderDeviceId: "device-1",
  };

  test("puts your own key first, then group and member copies of that file only", () => {
    const sources = imageKeySources({
      fileName: fileA,
      groups: [
        {
          id: groupId,
          image: urlFor(fileB),
          imageKey: stored,
          members: [
            { image: urlFor(fileA), imageKey: stored, userId: alice },
            { image: urlFor(fileB), imageKey: stored, userId: bob },
          ],
        },
        {
          id: "group-2",
          image: urlFor(fileA),
          imageKey: stored,
          members: [{ image: urlFor(fileA), imageKey: null, userId: alice }],
        },
      ],
      self: { id: alice, image: urlFor(fileA), imageKeySealed: "sealed" },
    });

    expect(sources).toEqual([
      { kind: "own", sealed: "sealed", userId: alice },
      { kind: "member", groupId, imageKey: stored, userId: alice },
      { kind: "group", groupId: "group-2", imageKey: stored },
    ]);
  });

  test("another person's picture never uses your own key", () => {
    const sources = imageKeySources({
      fileName: fileB,
      groups: [],
      self: { id: alice, image: urlFor(fileA), imageKeySealed: "sealed" },
    });

    expect(sources).toEqual([]);
  });
});

describe("mixed keys", () => {
  test("a key that can't be read yet wins over a broken one, so the picture is retried", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const stale = wrap({
      epochId: "epoch-0",
      fileName: fileA,
      imageKey,
      kind: "profile-image-key",
      ownerId: bob,
    });
    const broken = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    const sources = [memberSource(broken, alice), memberSource(stale)];
    const decryptor = createDecryptor();

    const first = await decryptor.load({ sources, url: urlFor(fileA) });
    epochKeys.set(`${groupId}:epoch-0`, generateGroupEpochKey());
    now = 61_000;
    await decryptor.load({ sources, url: urlFor(fileA) });

    expect(first).toEqual({ status: "stale-key" });
    expect(epochKeyRequests.filter((request) => request.endsWith("epoch-0"))).toHaveLength(2);
  });
});

describe("epoch keys", () => {
  const memberPicture = (fileName: string) => {
    const imageKey = encrypt({ fileName, ownerId: bob, purpose: "profile-image" });
    return memberSource(wrap({ fileName, imageKey, kind: "profile-image-key", ownerId: bob }));
  };

  test("many pictures under one epoch look the key up once", async () => {
    const files = Array.from({ length: 10 }, () => crypto.randomUUID());
    const decryptor = createDecryptor();

    const results = await Promise.all(
      files.map((fileName) =>
        decryptor.load({ sources: [memberPicture(fileName)], url: urlFor(fileName) }),
      ),
    );
    const later = crypto.randomUUID();
    await decryptor.load({ sources: [memberPicture(later)], url: urlFor(later) });

    expect(results.every((result) => result.status === "ready")).toBe(true);
    expect(epochKeyRequests).toEqual([`${groupId}:epoch-1`]);
  });

  test("a missing epoch key is looked up again after a minute, not before", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({
      epochId: "epoch-2",
      fileName: fileA,
      imageKey,
      kind: "profile-image-key",
      ownerId: bob,
    });
    const otherKey = encrypt({ fileName: fileB, ownerId: bob, purpose: "profile-image" });
    const other = wrap({
      epochId: "epoch-2",
      fileName: fileB,
      imageKey: otherKey,
      kind: "profile-image-key",
      ownerId: bob,
    });
    const decryptor = createDecryptor();

    await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });
    const soon = await decryptor.load({ sources: [memberSource(other)], url: urlFor(fileB) });
    expect(soon).toEqual({ status: "stale-key" });
    expect(epochKeyRequests).toEqual([`${groupId}:epoch-2`]);

    now = 60_000;
    await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });
    expect(epochKeyRequests).toEqual([`${groupId}:epoch-2`, `${groupId}:epoch-2`]);
  });

  test("a failed lookup isn't remembered", async () => {
    const source = memberPicture(fileA);
    let failing = true;
    const decryptor = createImageDecryptor({
      cachedUri: () => null,
      download: async (url) => served.get(url) ?? new Uint8Array(),
      generation: () => generation,
      getOwnImageKey: async () => null,
      now: () => now,
      resolveEpochKey: async ({ epochId, groupId: group }) => {
        epochKeyRequests.push(`${group}:${epochId}`);
        if (failing) throw new Error("offline");
        return epochKeys.get(`${group}:${epochId}`) ?? null;
      },
      writeCached: ({ fileName }) => `file:///cache/images/${fileName}`,
    });

    const first = await decryptor.load({ sources: [source], url: urlFor(fileA) });
    failing = false;
    const second = await decryptor.load({ sources: [memberPicture(fileB)], url: urlFor(fileB) });

    expect(first).toEqual({ status: "unavailable" });
    expect(second.status).toBe("ready");
    expect(epochKeyRequests).toHaveLength(2);
  });

  test("signing out forgets remembered epoch keys", async () => {
    const decryptor = createDecryptor();

    await decryptor.load({ sources: [memberPicture(fileA)], url: urlFor(fileA) });
    generation += 1;
    await decryptor.load({ sources: [memberPicture(fileB)], url: urlFor(fileB) });

    expect(epochKeyRequests).toEqual([`${groupId}:epoch-1`, `${groupId}:epoch-1`]);
  });
});

describe("downloads", () => {
  test("ten loads retrying together after a minute share one download", async () => {
    const imageKey = encrypt({ fileName: fileA, ownerId: bob, purpose: "profile-image" });
    const key = wrap({ fileName: fileA, imageKey, kind: "profile-image-key", ownerId: bob });
    const decryptor = createDecryptor();
    downloadError = new Error("offline");
    await decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) });
    downloadError = null;
    now = 61_000;

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        decryptor.load({ sources: [memberSource(key)], url: urlFor(fileA) }),
      ),
    );

    expect(results.every((result) => result.status === "ready")).toBe(true);
    expect(downloads).toHaveLength(2);
  });

  test("no more than four pictures download at once", async () => {
    const pictures = Array.from({ length: 10 }, () => {
      const fileName = crypto.randomUUID();
      const imageKey = encrypt({ fileName, ownerId: bob, purpose: "profile-image" });
      const key = wrap({ fileName, imageKey, kind: "profile-image-key", ownerId: bob });
      return { fileName, source: memberSource(key) };
    });
    let release = () => {};
    downloadGate = new Promise((resolve) => {
      release = resolve;
    });
    const decryptor = createDecryptor();

    const loads = pictures.map(({ fileName, source }) =>
      decryptor.load({ sources: [source], url: urlFor(fileName) }),
    );
    await Bun.sleep(10);
    expect(downloads).toHaveLength(4);
    release();
    const results = await Promise.all(loads);

    expect(results.every((result) => result.status === "ready")).toBe(true);
    expect(downloads).toHaveLength(10);
  });
});
