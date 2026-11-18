import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageClients } from "./storage.ts";
import { createRateLimiter } from "./transfer.ts";
import { uploadArchive } from "./upload.ts";

setDefaultTimeout(20_000);

const partSize = 1024 * 1024;
const data = Buffer.alloc(partSize, 7);
const received: number[] = [];
let answerParts = true;

const sourceServer = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (request) => {
    const range = /bytes=(\d+)-(\d+)/.exec(request.headers.get("range") ?? "");
    if (!range) return new Response("no range", { status: 400 });
    return new Response(data.subarray(Number(range[1]), Number(range[2]) + 1), {
      status: 206,
      headers: { etag: '"source"' },
    });
  },
});

const xml = (body: string) =>
  new Response(`<?xml version="1.0"?>${body}`, { headers: { "content-type": "application/xml" } });

const storageServer = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 30,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.searchParams.has("uploads"))
      return xml(
        "<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>",
      );
    if (request.method === "POST" && url.searchParams.has("uploads"))
      return xml(
        "<InitiateMultipartUploadResult><Bucket>maps</Bucket><Key>map.pmtiles</Key><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
      );
    if (request.method === "PUT") {
      if (!answerParts) return new Promise<Response>(() => {});
      received.push((await request.arrayBuffer()).byteLength);
      return new Response(null, { headers: { ETag: '"part"' } });
    }
    return xml('<CompleteMultipartUploadResult><ETag>"map"</ETag></CompleteMultipartUploadResult>');
  },
});

const stateDirs: string[] = [];
afterAll(async () => {
  sourceServer.stop(true);
  storageServer.stop(true);
  await Promise.all(stateDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const upload = async ({ bytesPerSecond }: { bytesPerSecond: number | null }) => {
  const stateDir = await mkdtemp(join(tmpdir(), "map-upload-"));
  stateDirs.push(stateDir);
  const clients = createStorageClients(
    {
      MAP_S3_ENDPOINT: `http://127.0.0.1:${storageServer.port}`,
      MAP_S3_REGION: "us-east-1",
      MAP_S3_ACCESS_KEY_ID: "key-id",
      MAP_S3_ACCESS_KEY: "secret",
      MAP_S3_FORCE_PATH_STYLE: true,
    },
    { requestTimeoutMs: 1_000 },
  );
  return uploadArchive({
    bucket: "maps",
    ...clients,
    key: "map.pmtiles",
    downloadLimiter: createRateLimiter({ bytesPerSecond: null }),
    uploadLimiter: createRateLimiter({ bytesPerSecond }),
    onProgress: () => {},
    onStart: () => {},
    partSize,
    sleep: async () => {},
    source: {
      etag: '"source"',
      size: partSize,
      url: `http://127.0.0.1:${sourceServer.port}/map.pmtiles`,
    },
    stallTimeoutMs: 1_500,
    stateDir,
  });
};

test("a part that takes longer to send than a whole request may take still uploads while bytes keep moving", async () => {
  answerParts = true;
  received.length = 0;
  const started = performance.now();
  await upload({ bytesPerSecond: partSize / 2 });
  expect(performance.now() - started).toBeGreaterThan(1_500);
  expect(received).toEqual([partSize]);
});

test("a part upload that stops getting answers fails at the stall timeout", async () => {
  answerParts = false;
  const warn = console.warn;
  console.warn = () => {};
  const started = performance.now();
  const failure = await upload({ bytesPerSecond: null }).then(
    () => null,
    (error: unknown) => error,
  );
  console.warn = warn;
  expect(failure).toBeInstanceOf(Error);
  expect(performance.now() - started).toBeLessThan(15_000);
});
