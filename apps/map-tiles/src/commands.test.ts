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
const NEW_KEY = "planet-20261107.pmtiles";

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

const archive = (key: string, publishedAt: number) => ({
  key,
  publishedAt: new Date(publishedAt).toISOString(),
  schemaVersion: "4.15.2",
  size: source.byteLength,
});

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

  test("publishes a verified build, keeps the replaced build and prunes expired builds", async () => {
    const r2 = createFakeR2();
    const now = Date.now();
    r2.putArchive("planet-current.pmtiles");
    r2.putArchive("planet-expired.pmtiles");
    r2.putManifest({
      current: archive("planet-current.pmtiles", now - 30 * DAY_MS),
      previous: [
        {
          ...archive("planet-expired.pmtiles", now - 60 * DAY_MS),
          servedUntil: new Date(now - 10 * DAY_MS).toISOString(),
        },
      ],
    });

    await publish(context(r2), undefined);

    const manifest = r2.manifest();
    expect(manifest?.current.key).toBe(NEW_KEY);
    expect(manifest?.previous.map((previous) => previous.key)).toEqual(["planet-current.pmtiles"]);
    expect(r2.objects.get(NEW_KEY)?.body).toEqual(source);
    expect(r2.objects.has("planet-current.pmtiles")).toBe(true);
    expect(r2.objects.has("planet-expired.pmtiles")).toBe(false);
  });

  test("never prunes the archive R2_PM_TILES_KEY points to", async () => {
    const r2 = createFakeR2();
    const now = Date.now();
    r2.putArchive("planet-fallback.pmtiles");
    r2.putManifest({
      current: archive("planet-current.pmtiles", now),
      previous: [
        {
          ...archive("planet-fallback.pmtiles", now - 60 * DAY_MS),
          servedUntil: new Date(now - 10 * DAY_MS).toISOString(),
        },
      ],
    });

    await publish(context(r2, { env: { R2_PM_TILES_KEY: "planet-fallback.pmtiles" } }), undefined);

    expect(r2.objects.has("planet-fallback.pmtiles")).toBe(true);
    expect(r2.writes).not.toContain("delete:planet-fallback.pmtiles");
  });

  test("deletes an upload that fails verification and leaves the manifest unchanged", async () => {
    const r2 = createFakeR2({ corruptOnComplete: true });
    const manifest = { current: archive("planet-current.pmtiles", Date.now()), previous: [] };
    r2.putManifest(manifest);

    await expect(publish(context(r2), undefined)).rejects.toThrow("it was deleted");

    expect(r2.objects.has(NEW_KEY)).toBe(false);
    expect(r2.manifest()).toEqual(manifest);
  });

  test("never overwrites an existing archive with a different size", async () => {
    const r2 = createFakeR2();
    r2.putArchive(NEW_KEY, new Uint8Array(10));

    await expect(publish(context(r2), undefined)).rejects.toThrow("never overwritten");

    expect(r2.writes).toEqual([]);
  });

  test("writes nothing on a dry run", async () => {
    const r2 = createFakeR2();

    await publish(context(r2, { dryRun: true }), undefined);

    expect(r2.writes).toEqual([]);
  });

  test("adopt only creates the first manifest", async () => {
    const r2 = createFakeR2();
    r2.putArchive("planet-20260315.pmtiles");

    await adopt(context(r2), "planet-20260315.pmtiles");
    expect(r2.manifest()?.current.key).toBe("planet-20260315.pmtiles");

    await expect(adopt(context(r2), "planet-20260315.pmtiles")).rejects.toThrow("already exists");
  });

  test("rollback refuses when the previous archive was deleted", async () => {
    const r2 = createFakeR2();
    const now = Date.now();
    const manifest = {
      current: archive("planet-current.pmtiles", now),
      previous: [
        {
          ...archive("planet-gone.pmtiles", now - DAY_MS),
          servedUntil: new Date(now + DAY_MS).toISOString(),
        },
      ],
    };
    r2.putManifest(manifest);

    await expect(rollback(context(r2))).rejects.toThrow("already been deleted");
    expect(r2.manifest()).toEqual(manifest);
  });
});
