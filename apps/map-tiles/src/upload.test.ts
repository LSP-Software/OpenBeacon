import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createRateLimiter } from "./transfer.ts";
import { getUploadStatePath, planParts, uploadArchive } from "./upload.ts";

const PART_SIZE = 1024;
const source = new Uint8Array(PART_SIZE * 3 + 100).map((_, index) => index % 251);
const sourceUrl = "https://build.example/20261107.pmtiles";
const unlimited = createRateLimiter({ bytesPerSecond: null });
const originalFetch = globalThis.fetch;

const readBody = async (body: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const createFakeR2 = ({
  existingParts = [],
  failUploads = new Map<number, number>(),
}: {
  existingParts?: { partNumber: number; size: number }[];
  failUploads?: Map<number, number>;
} = {}) => {
  const stored = new Map<number, Buffer>();
  const calls: string[] = [];
  let completedParts: { ETag?: string | undefined; PartNumber?: number | undefined }[] = [];
  let uploadCounter = 0;

  const send = async (command: unknown) => {
    if (command instanceof CreateMultipartUploadCommand) {
      uploadCounter += 1;
      calls.push("create");
      return { UploadId: `upload-${uploadCounter}` };
    }
    if (command instanceof AbortMultipartUploadCommand) {
      calls.push(`abort:${command.input.UploadId}`);
      return {};
    }
    if (command instanceof ListPartsCommand) {
      calls.push(`list:${command.input.UploadId}`);
      if (command.input.UploadId === "missing") {
        throw Object.assign(new Error("no upload"), { name: "NoSuchUpload" });
      }
      return {
        Parts: existingParts.map((part) => ({
          ETag: `"existing-${part.partNumber}"`,
          PartNumber: part.partNumber,
          Size: part.size,
        })),
      };
    }
    if (command instanceof UploadPartCommand) {
      const partNumber = command.input.PartNumber ?? 0;
      const body = await readBody(command.input.Body as Readable);
      const remainingFailures = failUploads.get(partNumber) ?? 0;

      calls.push(`upload:${partNumber}`);
      if (remainingFailures > 0) {
        failUploads.set(partNumber, remainingFailures - 1);
        throw new Error("connection reset");
      }
      if (createHash("md5").update(body).digest("base64") !== command.input.ContentMD5) {
        throw new Error("BadDigest");
      }
      stored.set(partNumber, body);
      return { ETag: `"etag-${partNumber}"` };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      calls.push("complete");
      completedParts = command.input.MultipartUpload?.Parts ?? [];
      return {};
    }
    throw new Error("Unexpected command");
  };

  return {
    calls,
    client: { send } as unknown as S3Client,
    completedParts: () => completedParts,
    stored,
  };
};

describe("uploadArchive", () => {
  let stateDir = "";

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "map-tiles-"));
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const [start, end] = (headers.get("Range") ?? "")
        .replace("bytes=", "")
        .split("-")
        .map(Number);

      if (headers.get("If-Match") !== '"source-etag"') {
        return new Response(null, { status: 412 });
      }

      return new Response(source.slice(start, (end ?? 0) + 1), { status: 206 });
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(stateDir, { force: true, recursive: true });
  });

  const run = (r2: ReturnType<typeof createFakeR2>, events: number[] = []) =>
    uploadArchive({
      bucket: "bucket",
      client: r2.client,
      downloadLimiter: unlimited,
      key: "planet-20261107.pmtiles",
      onProgress: (bytes) => events.push(bytes),
      onStart: () => {},
      partClient: r2.client,
      partSize: PART_SIZE,
      sleep: async () => {},
      source: { etag: '"source-etag"', size: source.byteLength, url: sourceUrl },
      stateDir,
      uploadLimiter: unlimited,
    });

  const statePath = () =>
    getUploadStatePath({ bucket: "bucket", key: "planet-20261107.pmtiles", stateDir });

  const writeState = async (overrides: Record<string, unknown>) => {
    await mkdir(dirname(statePath()), { recursive: true });
    await writeFile(
      statePath(),
      JSON.stringify({
        bucket: "bucket",
        key: "planet-20261107.pmtiles",
        partSize: PART_SIZE,
        size: source.byteLength,
        sourceEtag: '"source-etag"',
        sourceUrl,
        uploadId: "upload-existing",
        ...overrides,
      }),
    );
  };

  test("uploads every part with its MD5 and completes the upload in order", async () => {
    const r2 = createFakeR2();
    const events: number[] = [];

    await run(r2, events);

    expect(
      Buffer.concat([1, 2, 3, 4].map((part) => r2.stored.get(part) ?? Buffer.alloc(0))),
    ).toEqual(Buffer.from(source));
    expect(r2.completedParts()).toEqual(
      [1, 2, 3, 4].map((part) => ({ ETag: `"etag-${part}"`, PartNumber: part })),
    );
    expect(events.reduce((sum, bytes) => sum + bytes, 0)).toBe(source.byteLength);
    expect(await Bun.file(statePath()).exists()).toBe(false);
  });

  test("resumes an interrupted upload without re-uploading finished parts", async () => {
    await writeState({});
    const r2 = createFakeR2({
      existingParts: [
        { partNumber: 1, size: PART_SIZE },
        { partNumber: 2, size: 10 },
      ],
    });
    const started: number[] = [];

    await uploadArchive({
      bucket: "bucket",
      client: r2.client,
      downloadLimiter: unlimited,
      key: "planet-20261107.pmtiles",
      onProgress: () => {},
      onStart: ({ completedBytes, completedParts }) => started.push(completedBytes, completedParts),
      partClient: r2.client,
      partSize: PART_SIZE,
      sleep: async () => {},
      source: { etag: '"source-etag"', size: source.byteLength, url: sourceUrl },
      stateDir,
      uploadLimiter: unlimited,
    });

    expect(r2.calls).not.toContain("create");
    expect(r2.calls).not.toContain("upload:1");
    expect(r2.calls).toContain("upload:2");
    expect(started).toEqual([PART_SIZE, 1]);
    expect(r2.completedParts()[0]).toEqual({ ETag: '"existing-1"', PartNumber: 1 });
  });

  test("starts a new upload when the source build changed", async () => {
    await writeState({ sourceEtag: '"older-etag"' });
    const r2 = createFakeR2();

    await run(r2);

    expect(r2.calls.slice(0, 2)).toEqual(["abort:upload-existing", "create"]);
  });

  test("starts a new upload when R2 no longer has the saved upload", async () => {
    await writeState({ uploadId: "missing" });
    const r2 = createFakeR2();

    await run(r2);

    expect(r2.calls.slice(0, 2)).toEqual(["list:missing", "create"]);
  });

  test.each([
    ["truncated", "{ not json"],
    ["empty", ""],
    ["incomplete", JSON.stringify({ bucket: "bucket" })],
  ])("starts the upload again when the saved state is %s", async (_, contents) => {
    await mkdir(dirname(statePath()), { recursive: true });
    await writeFile(statePath(), contents);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const r2 = createFakeR2();

    await run(r2);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(r2.calls[0]).toBe("create");
    expect(r2.calls).toContain("complete");
    expect(await Bun.file(statePath()).exists()).toBe(false);
    warn.mockRestore();
  });

  test("retries a failed part and keeps the progress total correct", async () => {
    const r2 = createFakeR2({ failUploads: new Map([[2, 2]]) });
    const events: number[] = [];

    await run(r2, events);

    expect(r2.calls.filter((call) => call === "upload:2")).toHaveLength(3);
    expect(events.some((bytes) => bytes < 0)).toBe(true);
    expect(events.reduce((sum, bytes) => sum + bytes, 0)).toBe(source.byteLength);
  });

  test("stops after repeated failures and keeps the state for resuming", async () => {
    const r2 = createFakeR2({ failUploads: new Map([[3, 99]]) });

    await expect(run(r2)).rejects.toThrow("connection reset");

    expect(r2.calls).not.toContain("complete");
    expect(await Bun.file(statePath()).exists()).toBe(true);
  });
});

describe("planParts", () => {
  test("splits the archive into contiguous parts", () => {
    expect(planParts({ partSize: 10, size: 25 })).toEqual([
      { length: 10, partNumber: 1, start: 0 },
      { length: 10, partNumber: 2, start: 10 },
      { length: 5, partNumber: 3, start: 20 },
    ]);
  });

  test("rejects archives that need more parts than R2 allows", () => {
    expect(() => planParts({ partSize: 1, size: 10_001 })).toThrow("the limit is 10000");
  });
});
