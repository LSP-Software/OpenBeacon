import { beforeEach, expect, mock, test } from "bun:test";

const files = new Map<string, Uint8Array | string>();
let failWrites = false;
let failDirectoryDeletes = false;

class MockFile {
  path: string;
  constructor(...parts: string[]) {
    this.path = parts.join("/");
  }
  get exists() {
    return files.has(this.path);
  }
  get uri() {
    return `file://${this.path}`;
  }
  get name() {
    return this.path.split("/").pop() ?? "";
  }
  textSync = () => String(files.get(this.path));
  create = () => {
    files.set(this.path, new Uint8Array());
  };
  write = (content: Uint8Array | string) => {
    if (failWrites) {
      files.set(this.path, new Uint8Array([1]));
      throw new Error("disk full");
    }
    files.set(this.path, content);
  };
  move = (destination: { path: string }) => {
    if (files.has(destination.path)) throw new Error("exists");
    files.set(destination.path, files.get(this.path)!);
    files.delete(this.path);
    this.path = destination.path;
  };
  delete = () => {
    files.delete(this.path);
  };
}

mock.module("expo-file-system", () => ({
  Paths: { cache: "cache" },
  Directory: class {
    path: string;
    constructor(...parts: string[]) {
      this.path = parts.join("/");
    }
    get exists() {
      return [...files.keys()].some((path) => path.startsWith(`${this.path}/`));
    }
    create = () => {};
    list = () =>
      [...files.keys()]
        .filter((path) => path.startsWith(`${this.path}/`))
        .map((path) => new MockFile(path));
    delete = () => {
      if (failDirectoryDeletes) throw new Error("busy");
      for (const path of [...files.keys()]) {
        if (path.startsWith(`${this.path}/`)) files.delete(path);
      }
    };
  },
  File: MockFile,
}));

const { cachedImageUri, claimImageCache, clearImageCache, imageCacheGeneration, writeCachedImage } =
  await import("./imageCache.ts");

const fileName = "0b6f7d1e-3c2a-4b8e-9f10-2a3b4c5d6e7f";
const picture = new Uint8Array([7, 8, 9]);

beforeEach(() => {
  files.clear();
  failWrites = false;
  failDirectoryDeletes = false;
});

test("moves a fully written picture into place and leaves nothing else behind", () => {
  writeCachedImage({ bytes: new Uint8Array([1, 2]), fileName });
  writeCachedImage({ bytes: picture, fileName });

  expect([...files.entries()]).toEqual([[`cache/images/${fileName}`, picture]]);
  expect(cachedImageUri(fileName)).toBe(`file://cache/images/${fileName}`);
});

test("a failed write leaves no partial file and no picture", () => {
  failWrites = true;

  expect(() => writeCachedImage({ bytes: picture, fileName })).toThrow();
  expect(files.size).toBe(0);
  expect(cachedImageUri(fileName)).toBeNull();
});

test("drops writes from loads that started before a clear", () => {
  const generation = imageCacheGeneration();
  clearImageCache();

  expect(writeCachedImage({ bytes: picture, fileName, forGeneration: generation })).toBeNull();
  expect(files.size).toBe(0);
});

test("still drops older writes when the clear itself fails", () => {
  writeCachedImage({ bytes: picture, fileName });
  const generation = imageCacheGeneration();
  failDirectoryDeletes = true;

  expect(() => clearImageCache()).toThrow();
  expect(imageCacheGeneration()).not.toBe(generation);
});

test("keeps the cache for the same account and wipes it for another", () => {
  claimImageCache("owner-a");
  writeCachedImage({ bytes: picture, fileName });

  claimImageCache("owner-a");
  expect(cachedImageUri(fileName)).not.toBeNull();

  claimImageCache("owner-b");
  expect(cachedImageUri(fileName)).toBeNull();
});

test("removes a half-written picture left by a crash when the same account claims the cache", () => {
  claimImageCache("owner-a");
  writeCachedImage({ bytes: picture, fileName });
  files.set(`cache/images/${fileName}.part`, new Uint8Array([1]));

  claimImageCache("owner-a");

  expect([...files.keys()].sort()).toEqual(
    ["cache/images/owner", `cache/images/${fileName}`].sort(),
  );
});

test("wipes the cache when nobody is signed in", () => {
  claimImageCache("owner-a");
  writeCachedImage({ bytes: picture, fileName });

  claimImageCache(null);

  expect(files.size).toBe(0);
});

test("wipes a cache left by an older version that didn't record its owner", () => {
  writeCachedImage({ bytes: picture, fileName });

  claimImageCache("owner-a");

  expect(cachedImageUri(fileName)).toBeNull();
});

test("tries the wipe again at the next claim after it failed", () => {
  claimImageCache("owner-a");
  writeCachedImage({ bytes: picture, fileName });
  failDirectoryDeletes = true;

  expect(() => claimImageCache("owner-b")).toThrow();
  expect(cachedImageUri(fileName)).not.toBeNull();

  failDirectoryDeletes = false;
  claimImageCache("owner-a");

  expect(cachedImageUri(fileName)).toBeNull();
});
