import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { MAP_TILES_MANIFEST_KEY, type MapTilesManifest } from "@openbeacon/map-tiles";
import { publish, readMapStatus, repairManifest, rollback } from "./commands.ts";
import { parseEnv } from "./env.ts";
import { getUploadStatePath } from "./upload.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-08T00:00:00.000Z");

const createArchive = () => {
  const metadata = gzipSync(new TextEncoder().encode(JSON.stringify({ version: "4.15.2" })));
  const bytes = new Uint8Array(20_000 + metadata.byteLength).map((_, index) => index % 7);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PMTiles"), 0);
  view.setUint8(7, 3);
  view.setBigUint64(24, 20_000n, true);
  view.setBigUint64(32, BigInt(metadata.byteLength), true);
  view.setUint8(97, 2);
  bytes.set(metadata, 20_000);
  return bytes;
};

const source = createArchive();
const originalFetch = globalThis.fetch;

const createFakeStorage = ({
  corruptOnComplete = false,
  failCompletes = 0,
}: {
  corruptOnComplete?: boolean;
  failCompletes?: number;
} = {}) => {
  const objects = new Map<string, { body: Uint8Array; etag: string }>();
  const parts = new Map<number, Uint8Array>();
  const writes: string[] = [];
  let version = 0;

  const store = (key: string, body: Uint8Array) => {
    version += 1;
    objects.set(key, { body, etag: `"v${version}"` });
  };

  const fail = (name: string) => {
    throw Object.assign(new Error(name), { name });
  };

  const send = async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      const object = objects.get(command.input.Key ?? "") ?? fail("NoSuchKey");
      const [start, end] = (command.input.Range ?? `bytes=0-${object.body.byteLength - 1}`)
        .replace("bytes=", "")
        .split("-")
        .map(Number);
      const body = object.body.slice(start, (end ?? 0) + 1);
      return {
        Body: {
          transformToByteArray: async () => body,
          transformToString: async () => new TextDecoder().decode(body),
        },
        ETag: object.etag,
      };
    }
    if (command instanceof HeadObjectCommand) {
      const object = objects.get(command.input.Key ?? "") ?? fail("NotFound");
      return { ContentLength: object.body.byteLength };
    }
    if (command instanceof PutObjectCommand) {
      const existing = objects.get(command.input.Key ?? "");
      if (
        (command.input.IfNoneMatch === "*" && existing) ||
        (command.input.IfMatch && existing?.etag !== command.input.IfMatch)
      ) {
        fail("PreconditionFailed");
      }
      writes.push(`put:${command.input.Key}`);
      store(command.input.Key ?? "", new TextEncoder().encode(String(command.input.Body)));
      return { ETag: objects.get(command.input.Key ?? "")?.etag };
    }
    if (command instanceof DeleteObjectCommand) {
      writes.push(`delete:${command.input.Key}`);
      objects.delete(command.input.Key ?? "");
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      return {
        Contents: [...objects].map(([Key, object]) => ({ Key, Size: object.body.byteLength })),
      };
    }
    if (command instanceof CreateMultipartUploadCommand) {
      writes.push(`create:${command.input.Key}`);
      return { UploadId: "upload-1" };
    }
    if (command instanceof ListPartsCommand) {
      return { Parts: [] };
    }
    if (command instanceof AbortMultipartUploadCommand) {
      return {};
    }
    if (command instanceof UploadPartCommand) {
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body as Readable) {
        chunks.push(Buffer.from(chunk));
      }
      parts.set(command.input.PartNumber ?? 0, Buffer.concat(chunks));
      return { ETag: `"part-${command.input.PartNumber}"` };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      if (failCompletes > 0) {
        failCompletes -= 1;
        fail("InternalError");
      }
      const body = Buffer.concat([...parts].sort(([a], [b]) => a - b).map(([, part]) => part));
      if (corruptOnComplete) {
        body[200] = (body[200] ?? 0) + 1;
      }
      store(command.input.Key ?? "", new Uint8Array(body));
      return {};
    }
    if (command instanceof ListMultipartUploadsCommand) {
      return { Uploads: [] };
    }
    throw new Error("Unexpected command");
  };

  return {
    client: { send } as unknown as S3Client,
    manifest: () => {
      const object = objects.get(MAP_TILES_MANIFEST_KEY);
      return object
        ? (JSON.parse(new TextDecoder().decode(object.body)) as MapTilesManifest)
        : null;
    },
    objects,
    putArchive: (key: string, body: Uint8Array = source) => store(key, body),
    putManifest: (manifest: MapTilesManifest) =>
      store(MAP_TILES_MANIFEST_KEY, new TextEncoder().encode(JSON.stringify(manifest))),
    writes,
  };
};

const archive = (key: string, build: string) => ({
  build,
  key,
  publishedAt: new Date(
    Date.parse(`${build.slice(0, 4)}-${build.slice(4, 6)}-${build.slice(6, 8)}`) + DAY_MS,
  ).toISOString(),
  schemaVersion: "4.15.2",
  size: source.byteLength,
});

const otherBuild = () => {
  const body = source.slice();
  body[200] = (body[200] ?? 0) + 1;
  return body;
};

describe("map tiles commands", () => {
  let stateDir = "";
  let newestBuild = "20261107";

  beforeEach(async () => {
    setSystemTime(now);
    newestBuild = "20261107";
    stateDir = await mkdtemp(join(tmpdir(), "map-tiles-commands-"));
    spyOn(console, "log").mockImplementation(() => {});
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("builds.json")) {
        return Response.json([
          { key: `${newestBuild}.pmtiles`, size: source.byteLength, version: "4.15.2" },
        ]);
      }
      if (init?.method === "HEAD") {
        return new Response(null, {
          headers: { "content-length": String(source.byteLength), etag: '"source"' },
        });
      }
      const [start, end] = (new Headers(init?.headers).get("Range") ?? "")
        .replace("bytes=", "")
        .split("-")
        .map(Number);
      return new Response(source.slice(start, (end ?? 0) + 1), { status: 206 });
    }) as typeof fetch;
  });

  afterEach(async () => {
    setSystemTime();
    globalThis.fetch = originalFetch;
    await rm(stateDir, { force: true, recursive: true });
  });

  const context = (storage: ReturnType<typeof createFakeStorage>) => ({
    client: storage.client,
    env: parseEnv({
      MAP_S3_REGION: "us-east-1",
      MAP_S3_ACCESS_KEY_ID: "key",
      MAP_S3_ENDPOINT: "https://map-storage.example.com",
      MAP_S3_BUCKET_NAME: "bucket",
      MAP_S3_ACCESS_KEY: "secret",
      MAP_TILES_STATE_DIR: stateDir,
    }),
    partClient: storage.client,
  });

  const update = { manual: true };
  const scheduledUpdate = { manual: false };

  test("replaces the standby slot, switches to it and keeps the old map for rollback", async () => {
    const storage = createFakeStorage();
    storage.putArchive("planet-a.pmtiles", otherBuild());
    storage.putArchive("planet-b.pmtiles", otherBuild());
    storage.putManifest({
      current: "a",
      slots: {
        a: archive("planet-a.pmtiles", "20261007"),
        b: {
          ...archive("planet-b.pmtiles", "20260907"),
          servedUntil: new Date(now - 24 * DAY_MS).toISOString(),
        },
      },
    });

    const result = await publish(context(storage), update);

    const manifest = storage.manifest();
    expect(result.published).toBe(true);
    expect(manifest?.current).toBe("b");
    expect(manifest?.slots.b?.build).toBe("20261107");
    expect(manifest?.slots.a?.build).toBe("20261007");
    expect(storage.objects.get("planet-b.pmtiles")?.body).toEqual(source);
    expect([...storage.objects.keys()].filter((key) => key.endsWith(".pmtiles")).sort()).toEqual([
      "planet-a.pmtiles",
      "planet-b.pmtiles",
    ]);
  });

  test("clears the standby slot in the manifest before overwriting it", async () => {
    const storage = createFakeStorage();
    storage.putArchive("planet-a.pmtiles", otherBuild());
    storage.putManifest({
      current: "b",
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20260907"),
          servedUntil: new Date(now - 24 * DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261007"),
      },
    });

    await publish(context(storage), update);

    expect(storage.writes.slice(0, 2)).toEqual([
      `put:${MAP_TILES_MANIFEST_KEY}`,
      "create:planet-a.pmtiles",
    ]);
  });

  test("leaves a standby slot alone while open maps may still use it", async () => {
    const storage = createFakeStorage();
    storage.putManifest({
      current: "b",
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20260907"),
          servedUntil: new Date(now + 4 * DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261007"),
      },
    });

    const result = await publish(context(storage), update);

    expect(result).toMatchObject({ published: false, message: expect.stringContaining("in use") });
    expect(storage.writes).toEqual([]);
  });

  test("waits for the update interval before replacing the map", async () => {
    const storage = createFakeStorage();
    storage.putManifest({
      current: "a",
      slots: { a: archive("planet-a.pmtiles", "20261029"), b: null },
    });

    const result = await publish(context(storage), scheduledUpdate);

    expect(result).toMatchObject({ published: false, message: expect.stringContaining("due") });
    expect(storage.writes).toEqual([]);
  });

  test("an unfinished upload of an older build does not bring the update forward", async () => {
    const storage = createFakeStorage();
    storage.putManifest({
      current: "a",
      slots: { a: archive("planet-a.pmtiles", "20261029"), b: null },
    });
    const statePath = getUploadStatePath({ bucket: "bucket", key: "planet-b.pmtiles", stateDir });
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(
      statePath,
      JSON.stringify({
        bucket: "bucket",
        key: "planet-b.pmtiles",
        partSize: 1024,
        size: 1024,
        sourceEtag: '"old"',
        sourceUrl: "https://build.protomaps.com/20261101.pmtiles",
        uploadId: "old-upload",
      }),
    );

    const result = await publish(context(storage), scheduledUpdate);

    expect(result).toMatchObject({ published: false, message: expect.stringContaining("due") });
    expect(storage.writes).toEqual([]);
  });

  test("does nothing when the newest build is already current", async () => {
    const storage = createFakeStorage();
    storage.putManifest({
      current: "a",
      slots: { a: archive("planet-a.pmtiles", "20261107"), b: null },
    });

    expect((await publish(context(storage), update)).published).toBe(false);
    expect(storage.writes).toEqual([]);
  });

  test("does not switch to an upload that fails verification", async () => {
    const storage = createFakeStorage({ corruptOnComplete: true });
    const manifest = {
      current: "a" as const,
      slots: { a: archive("planet-a.pmtiles", "20261007"), b: null },
    };
    storage.putManifest(manifest);

    await expect(publish(context(storage), update)).rejects.toThrow("not published");

    expect(storage.manifest()).toEqual(manifest);
  });

  test("downloads the first map into slot a straight away", async () => {
    const storage = createFakeStorage();

    const result = await publish(context(storage), scheduledUpdate);

    expect(result.published).toBe(true);
    expect(storage.manifest()).toMatchObject({
      current: "a",
      slots: { a: { build: "20261107" }, b: null },
    });
    expect(storage.objects.get("planet-a.pmtiles")?.body).toEqual(source);
  });

  test("fills the empty slot b at the next scheduled update", async () => {
    const storage = createFakeStorage();
    storage.putArchive("planet-a.pmtiles", otherBuild());
    storage.putManifest({
      current: "a",
      slots: {
        a: archive("planet-a.pmtiles", "20261007"),
        b: null,
      },
    });

    const result = await publish(context(storage), scheduledUpdate);

    expect(result.published).toBe(true);
    expect(storage.manifest()).toMatchObject({
      current: "b",
      slots: { a: { build: "20261007" }, b: { build: "20261107" } },
    });
  });

  test("a manual update ignores the update interval", async () => {
    const storage = createFakeStorage();
    storage.putArchive("planet-a.pmtiles", otherBuild());
    storage.putManifest({
      current: "a",
      slots: {
        a: archive("planet-a.pmtiles", "20261106"),
        b: null,
      },
    });

    expect((await publish(context(storage), scheduledUpdate)).published).toBe(false);
    expect((await publish(context(storage), update)).published).toBe(true);
  });

  test("skips the upload when the slot already holds the build and drops its stale state", async () => {
    const storage = createFakeStorage();
    storage.putArchive("planet-a.pmtiles");
    const statePath = getUploadStatePath({ bucket: "bucket", key: "planet-a.pmtiles", stateDir });
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, "{}");

    await publish(context(storage), update);

    expect(storage.writes).toEqual([`put:${MAP_TILES_MANIFEST_KEY}`]);
    expect(storage.manifest()?.slots.a?.build).toBe("20261107");
    expect(await Bun.file(statePath).exists()).toBe(false);
    expect((await readMapStatus(context(storage))).resumableUploads).toEqual([]);
  });

  test("a scheduled update resumes a manual update that stopped before the interval", async () => {
    const storage = createFakeStorage({ failCompletes: 1 });
    storage.putArchive("planet-a.pmtiles", otherBuild());
    storage.putArchive("planet-b.pmtiles", otherBuild());
    storage.putManifest({
      current: "a",
      slots: {
        a: archive("planet-a.pmtiles", "20261106"),
        b: {
          ...archive("planet-b.pmtiles", "20260907"),
          servedUntil: new Date(now - 10 * DAY_MS).toISOString(),
        },
      },
    });

    await expect(publish(context(storage), update)).rejects.toThrow("Upload stopped");
    expect(storage.manifest()?.slots.b).toBeNull();

    const result = await publish(context(storage), scheduledUpdate);

    expect(result.published).toBe(true);
    expect(storage.writes.filter((write) => write === "create:planet-b.pmtiles")).toHaveLength(1);
    expect(storage.manifest()).toMatchObject({
      current: "b",
      slots: { a: { build: "20261106" }, b: { build: "20261107" } },
    });
    expect((await publish(context(storage), scheduledUpdate)).published).toBe(false);
  });

  test("rollback switches back to the standby slot", async () => {
    const storage = createFakeStorage();
    storage.putArchive("planet-a.pmtiles");
    storage.putManifest({
      current: "b",
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20261007"),
          servedUntil: new Date(now + 6 * DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261107"),
      },
    });

    expect(await rollback(context(storage))).toContain("a-20261007");

    expect(storage.manifest()?.current).toBe("a");
    expect(storage.manifest()?.rejectedBuild).toBe("20261107");
    expect(storage.manifest()?.slots.a?.servedUntil).toBeUndefined();
  });

  describe("after a rollback", () => {
    const rolledBack = (): MapTilesManifest => ({
      current: "a",
      rejectedBuild: "20261107",
      slots: {
        a: archive("planet-a.pmtiles", "20261007"),
        b: {
          ...archive("planet-b.pmtiles", "20261107"),
          servedUntil: new Date(now - 2 * DAY_MS).toISOString(),
        },
      },
    });

    test("a scheduled update skips the rolled-back build", async () => {
      const storage = createFakeStorage();
      storage.putManifest(rolledBack());

      expect(await publish(context(storage), scheduledUpdate)).toEqual({
        published: false,
        message:
          "Build 20261107 was rolled back, so it is skipped until Protomaps publishes a newer build",
      });
      expect(storage.writes).toEqual([]);
    });

    test("a scheduled update installs a newer build and stops skipping", async () => {
      const storage = createFakeStorage();
      storage.putManifest(rolledBack());
      newestBuild = "20261108";

      expect((await publish(context(storage), scheduledUpdate)).published).toBe(true);
      expect(storage.manifest()).toMatchObject({
        current: "b",
        slots: { b: { build: "20261108" } },
      });
      expect(storage.manifest()?.rejectedBuild).toBeUndefined();
    });

    test("a manual update installs the rolled-back build anyway", async () => {
      const storage = createFakeStorage();
      storage.putManifest(rolledBack());

      expect((await publish(context(storage), update)).published).toBe(true);
      expect(storage.manifest()).toMatchObject({
        current: "b",
        slots: { b: { build: "20261107" } },
      });
      expect(storage.manifest()?.rejectedBuild).toBeUndefined();
    });
  });

  test("rollback refuses when the standby map is missing from map storage", async () => {
    const storage = createFakeStorage();
    const manifest = {
      current: "b" as const,
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20261007"),
          servedUntil: new Date(now + DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261107"),
      },
    };
    storage.putManifest(manifest);

    await expect(rollback(context(storage))).rejects.toThrow("missing from map storage");
    expect(storage.manifest()).toEqual(manifest);
  });

  test("status reports both slots, when the next update is due and stray archives", async () => {
    const storage = createFakeStorage();
    storage.putArchive("planet-20260315.pmtiles");
    storage.putManifest({
      current: "b",
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20261007"),
          servedUntil: new Date(now + 2 * DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261103"),
      },
    });

    const status = await readMapStatus(context(storage));

    expect(status).toMatchObject({
      bucket: "bucket",
      current: "b",
      slots: {
        a: { build: "20261007" },
        b: { build: "20261103", servedUntil: null },
      },
      standbyReplaceableFrom: new Date(now + 3 * DAY_MS).toISOString(),
      nextUpdateDueAt: new Date(now + 25 * DAY_MS).toISOString(),
      speedLimitMbps: null,
      untrackedArchives: [{ key: "planet-20260315.pmtiles", size: source.byteLength }],
    });
  });

  test("status reports an empty bucket", async () => {
    expect(await readMapStatus(context(createFakeStorage()))).toMatchObject({
      current: null,
      slots: { a: null, b: null },
      nextUpdateDueAt: null,
      standbyReplaceableFrom: null,
    });
  });

  describe("repairManifest", () => {
    const twoSlots = (): MapTilesManifest => ({
      current: "b",
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20261007"),
          servedUntil: new Date(now + 2 * DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261107"),
      },
    });

    test("leaves a manifest whose maps are all in map storage alone", async () => {
      const storage = createFakeStorage();
      storage.putManifest(twoSlots());
      storage.putArchive("planet-a.pmtiles");
      storage.putArchive("planet-b.pmtiles");

      expect(await repairManifest(context(storage))).toBeNull();
      expect(await repairManifest(context(createFakeStorage()))).toBeNull();
      expect(storage.writes).toEqual([]);
    });

    test("drops a missing standby map so it is never served or rolled back to", async () => {
      const storage = createFakeStorage();
      storage.putManifest(twoSlots());
      storage.putArchive("planet-b.pmtiles");

      expect(await repairManifest(context(storage))).toContain("slot a was removed");
      expect(storage.manifest()).toEqual({
        ...twoSlots(),
        slots: { ...twoSlots().slots, a: null },
      });
    });

    test("rolls back when the map in use is missing, without skipping its build later", async () => {
      const storage = createFakeStorage();
      storage.putManifest(twoSlots());
      storage.putArchive("planet-a.pmtiles");

      expect(await repairManifest(context(storage))).toContain("rolled back to slot a");
      const { servedUntil: _servedUntil, ...restored } = twoSlots().slots.a ?? {};
      expect(storage.manifest()).toEqual({ current: "a", slots: { a: restored, b: null } });
    });

    test("leaves the manifest alone when it changes while being checked", async () => {
      const storage = createFakeStorage();
      storage.putManifest(twoSlots());
      const send = storage.client.send.bind(storage.client);
      let reads = 0;
      const client = {
        send: async (command: unknown) => {
          if (command instanceof GetObjectCommand) {
            reads += 1;
          }
          if (reads === 2 && command instanceof GetObjectCommand) {
            storage.putArchive("planet-a.pmtiles");
            storage.putManifest({ ...twoSlots(), current: "a" });
          }
          return send(command as never);
        },
      } as unknown as S3Client;

      expect(await repairManifest({ ...context(storage), client })).toContain("left alone");
      expect(storage.manifest()).toMatchObject({ current: "a" });
      expect(storage.writes).not.toContain(`delete:${MAP_TILES_MANIFEST_KEY}`);
    });

    test("removes the manifest when none of its maps are in map storage, so the next update starts over", async () => {
      const storage = createFakeStorage();
      storage.putManifest(twoSlots());

      expect(await repairManifest(context(storage))).toContain("manifest was removed");
      expect(storage.manifest()).toBeNull();

      const result = await publish(context(storage), scheduledUpdate);
      expect(result.published).toBe(true);
      expect(storage.manifest()).toMatchObject({ current: "a", slots: { b: null } });
    });
  });
});
