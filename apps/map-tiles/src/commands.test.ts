import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { MAP_TILES_MANIFEST_KEY, type MapTilesManifest } from "@openbeacon/map-tiles";
import { adopt, publish, rollback } from "./commands.ts";
import { parseEnv } from "./env.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

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

const createFakeR2 = ({ corruptOnComplete = false }: { corruptOnComplete?: boolean } = {}) => {
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
      const body = Buffer.concat([...parts].sort(([a], [b]) => a - b).map(([, part]) => part));
      if (corruptOnComplete) {
        body[200] = (body[200] ?? 0) + 1;
      }
      store(command.input.Key ?? "", new Uint8Array(body));
      return {};
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

const archive = (key: string, build: string, publishedAt: number) => ({
  build,
  key,
  publishedAt: new Date(publishedAt).toISOString(),
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

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "map-tiles-commands-"));
    spyOn(console, "log").mockImplementation(() => {});
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("builds.json")) {
        return Response.json([
          { key: "20261107.pmtiles", size: source.byteLength, version: "4.15.2" },
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
    globalThis.fetch = originalFetch;
    await rm(stateDir, { force: true, recursive: true });
  });

  const context = (
    r2: ReturnType<typeof createFakeR2>,
    overrides: { dryRun?: boolean; env?: Record<string, string> } = {},
  ) => ({
    client: r2.client,
    dryRun: overrides.dryRun ?? false,
    env: parseEnv({
      R2_ACCESS_KEY_ID: "key",
      R2_ACCOUNT_ID: "account",
      R2_BUCKET: "bucket",
      R2_SECRET_ACCESS_KEY: "secret",
      MAP_TILES_STATE_DIR: stateDir,
      ...overrides.env,
    }),
    partClient: r2.client,
    yes: true,
  });

  test("replaces the standby slot, switches to it and keeps the old map for rollback", async () => {
    const r2 = createFakeR2();
    const now = Date.now();
    r2.putArchive("planet-a.pmtiles", otherBuild());
    r2.putArchive("planet-b.pmtiles", otherBuild());
    r2.putManifest({
      current: "a",
      slots: {
        a: archive("planet-a.pmtiles", "20261007", now - 31 * DAY_MS),
        b: {
          ...archive("planet-b.pmtiles", "20260907", now - 61 * DAY_MS),
          servedUntil: new Date(now - 24 * DAY_MS).toISOString(),
        },
      },
    });

    const result = await publish(context(r2), { date: undefined });

    const manifest = r2.manifest();
    expect(result.published).toBe(true);
    expect(manifest?.current).toBe("b");
    expect(manifest?.slots.b?.build).toBe("20261107");
    expect(manifest?.slots.a?.build).toBe("20261007");
    expect(r2.objects.get("planet-b.pmtiles")?.body).toEqual(source);
    expect([...r2.objects.keys()].filter((key) => key.endsWith(".pmtiles")).sort()).toEqual([
      "planet-a.pmtiles",
      "planet-b.pmtiles",
    ]);
  });

  test("clears the standby slot in the manifest before overwriting it", async () => {
    const r2 = createFakeR2();
    const now = Date.now();
    r2.putArchive("planet-a.pmtiles", otherBuild());
    r2.putManifest({
      current: "b",
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20260907", now - 61 * DAY_MS),
          servedUntil: new Date(now - 24 * DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261007", now - 31 * DAY_MS),
      },
    });

    await publish(context(r2), { date: undefined });

    expect(r2.writes.slice(0, 2)).toEqual([
      `put:${MAP_TILES_MANIFEST_KEY}`,
      "create:planet-a.pmtiles",
    ]);
  });

  test("leaves a standby slot alone while open maps may still use it", async () => {
    const r2 = createFakeR2();
    const now = Date.now();
    r2.putManifest({
      current: "b",
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20260907", now - 3 * DAY_MS),
          servedUntil: new Date(now + 4 * DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261007", now - 3 * DAY_MS),
      },
    });

    const result = await publish(context(r2), { date: undefined });

    expect(result).toMatchObject({ published: false, message: expect.stringContaining("in use") });
    expect(r2.writes).toEqual([]);
  });

  test("waits for the update interval before replacing the map", async () => {
    const r2 = createFakeR2();
    r2.putManifest({
      current: "a",
      slots: { a: archive("planet-a.pmtiles", "20261007", Date.now() - 10 * DAY_MS), b: null },
    });

    const result = await publish(context(r2), { date: undefined, minIntervalMs: 30 * DAY_MS });

    expect(result).toMatchObject({ published: false, message: expect.stringContaining("due") });
    expect(r2.writes).toEqual([]);
  });

  test("does nothing when the newest build is already current", async () => {
    const r2 = createFakeR2();
    r2.putManifest({
      current: "a",
      slots: { a: archive("planet-a.pmtiles", "20261107", Date.now() - 40 * DAY_MS), b: null },
    });

    expect((await publish(context(r2), { date: undefined })).published).toBe(false);
    expect(r2.writes).toEqual([]);
  });

  test("deletes an adopted archive when its slot is replaced so the bucket keeps two maps", async () => {
    const r2 = createFakeR2();
    const now = Date.now();
    r2.putArchive("planet-20260315.pmtiles", otherBuild());
    r2.putArchive("planet-b.pmtiles", otherBuild());
    r2.putManifest({
      current: "b",
      slots: {
        a: {
          ...archive("planet-20260315.pmtiles", "20260315", now - 61 * DAY_MS),
          servedUntil: new Date(now - 24 * DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261007", now - 31 * DAY_MS),
      },
    });

    await publish(context(r2), { date: undefined });

    expect(r2.objects.has("planet-20260315.pmtiles")).toBe(false);
    expect(r2.manifest()?.slots.a?.key).toBe("planet-a.pmtiles");
  });

  test("asks for adopt before publishing next to an archive the manifest does not know", async () => {
    const r2 = createFakeR2();
    r2.putArchive("planet-20260315.pmtiles");

    await expect(
      publish(context(r2, { env: { R2_PM_TILES_KEY: "planet-20260315.pmtiles" } }), {
        date: undefined,
      }),
    ).rejects.toThrow("run adopt first");
    expect(r2.writes).toEqual([]);
  });

  test("does not switch to an upload that fails verification", async () => {
    const r2 = createFakeR2({ corruptOnComplete: true });
    const manifest = {
      current: "a" as const,
      slots: { a: archive("planet-a.pmtiles", "20261007", Date.now() - 40 * DAY_MS), b: null },
    };
    r2.putManifest(manifest);

    await expect(publish(context(r2), { date: undefined })).rejects.toThrow("not published");

    expect(r2.manifest()).toEqual(manifest);
  });

  test("skips the upload when the slot already holds the build", async () => {
    const r2 = createFakeR2();
    r2.putArchive("planet-a.pmtiles");

    await publish(context(r2), { date: undefined });

    expect(r2.writes).toEqual([`put:${MAP_TILES_MANIFEST_KEY}`]);
    expect(r2.manifest()?.slots.a?.build).toBe("20261107");
  });

  test("writes nothing on a dry run", async () => {
    const r2 = createFakeR2();

    await publish(context(r2, { dryRun: true }), { date: undefined });

    expect(r2.writes).toEqual([]);
  });

  test("adopt puts an existing archive in slot a and only creates the first manifest", async () => {
    const r2 = createFakeR2();
    r2.putArchive("planet-20260315.pmtiles");

    await adopt(context(r2), "planet-20260315.pmtiles", undefined);
    expect(r2.manifest()).toMatchObject({
      current: "a",
      slots: { a: { key: "planet-20260315.pmtiles", build: "20260315" }, b: null },
    });

    await expect(adopt(context(r2), "planet-20260315.pmtiles", undefined)).rejects.toThrow(
      "already exists",
    );
  });

  test("rollback switches back to the standby slot", async () => {
    const r2 = createFakeR2();
    const now = Date.now();
    r2.putArchive("planet-a.pmtiles");
    r2.putManifest({
      current: "b",
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20261007", now - DAY_MS),
          servedUntil: new Date(now + 6 * DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261107", now - DAY_MS),
      },
    });

    await rollback(context(r2));

    expect(r2.manifest()?.current).toBe("a");
    expect(r2.manifest()?.slots.a?.servedUntil).toBeUndefined();
  });

  test("rollback refuses when the standby map is missing from R2", async () => {
    const r2 = createFakeR2();
    const now = Date.now();
    const manifest = {
      current: "b" as const,
      slots: {
        a: {
          ...archive("planet-a.pmtiles", "20261007", now - DAY_MS),
          servedUntil: new Date(now + DAY_MS).toISOString(),
        },
        b: archive("planet-b.pmtiles", "20261107", now),
      },
    };
    r2.putManifest(manifest);

    await expect(rollback(context(r2))).rejects.toThrow("missing from R2");
    expect(r2.manifest()).toEqual(manifest);
  });
});
