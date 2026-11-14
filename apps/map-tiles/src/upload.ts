import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { tryCatch } from "@openbeacon/shared";
import { z } from "zod";
import { fetchSourceRange } from "./source.ts";
import type { RateLimiter } from "./transfer.ts";

export const PART_SIZE = 64 * 1024 * 1024;
const MAX_PARTS = 10_000;
const PART_ATTEMPTS = 5;
const CONCURRENCY = 4;
const STALL_TIMEOUT_MS = 120_000;
const UPLOAD_CHUNK_SIZE = 256 * 1024;

export const planParts = ({ partSize, size }: { partSize: number; size: number }) => {
  const count = Math.ceil(size / partSize);

  if (count > MAX_PARTS) {
    throw new Error(`A ${size} byte archive needs ${count} parts; the limit is ${MAX_PARTS}`);
  }

  return Array.from({ length: count }, (_, index) => ({
    partNumber: index + 1,
    start: index * partSize,
    length: Math.min(partSize, size - index * partSize),
  }));
};

const uploadStateSchema = z
  .object({
    bucket: z.string(),
    key: z.string(),
    partSize: z.number().int().positive(),
    size: z.number().int().positive(),
    sourceEtag: z.string(),
    sourceUrl: z.string(),
    uploadId: z.string().min(1),
  })
  .strict();

type UploadState = z.infer<typeof uploadStateSchema>;

export const getUploadStatePath = ({
  bucket,
  key,
  stateDir,
}: {
  bucket: string;
  key: string;
  stateDir: string;
}) => join(stateDir, bucket, `${key}.json`);

export const readUploadState = async (path: string) => {
  const result = await tryCatch<string, NodeJS.ErrnoException>(readFile(path, "utf8"));

  if (result.error) {
    if (result.error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Could not read upload state ${path}: ${result.error.message}`);
  }

  const json = await tryCatch((async (): Promise<unknown> => JSON.parse(result.data))());
  const parsed = json.error ? null : uploadStateSchema.safeParse(json.data);

  if (!parsed?.success) {
    console.warn(`Ignored the unreadable upload state ${path}; the upload starts again`);
    await rm(path, { force: true });
    return null;
  }

  return parsed.data;
};

const writeUploadState = async (path: string, state: UploadState) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${path}.tmp`, path);
};

const listUploadedParts = async ({ client, state }: { client: S3Client; state: UploadState }) => {
  const parts = new Map<number, { etag: string; size: number }>();
  let marker: string | undefined;

  do {
    const response = await client.send(
      new ListPartsCommand({
        Bucket: state.bucket,
        Key: state.key,
        UploadId: state.uploadId,
        ...(marker ? { PartNumberMarker: marker } : {}),
      }),
    );

    for (const part of response.Parts ?? []) {
      if (part.PartNumber && part.ETag && part.Size !== undefined) {
        parts.set(part.PartNumber, { etag: part.ETag, size: part.Size });
      }
    }

    marker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
  } while (marker);

  return parts;
};

const abortUnfinishedUploads = async ({
  bucket,
  client,
  key,
}: {
  bucket: string;
  client: S3Client;
  key: string;
}) => {
  const uploadIds: string[] = [];
  let markers: { KeyMarker?: string; UploadIdMarker?: string } = {};

  do {
    const response = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        Prefix: key,
        ...markers,
      }),
    );

    for (const upload of response.Uploads ?? []) {
      if (upload.Key === key && upload.UploadId) {
        uploadIds.push(upload.UploadId);
      }
    }

    markers = response.IsTruncated
      ? {
          ...(response.NextKeyMarker ? { KeyMarker: response.NextKeyMarker } : {}),
          ...(response.NextUploadIdMarker ? { UploadIdMarker: response.NextUploadIdMarker } : {}),
        }
      : {};
  } while (markers.KeyMarker || markers.UploadIdMarker);

  for (const uploadId of uploadIds) {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  if (uploadIds.length > 0) {
    console.log(`Aborted ${uploadIds.length} stale multipart upload(s) for ${key}`);
  }
};

const downloadPart = async ({
  etag,
  limiter,
  part,
  url,
}: {
  etag: string;
  limiter: RateLimiter;
  part: { start: number; length: number };
  url: string;
}) => {
  const controller = new AbortController();
  let stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  const buffer = Buffer.allocUnsafe(part.length);
  let offset = 0;

  try {
    const response = await fetchSourceRange({
      etag,
      length: part.length,
      signal: controller.signal,
      start: part.start,
      url,
    });

    if (!response.body) {
      throw new Error("The range response has no body");
    }

    for await (const chunk of response.body) {
      clearTimeout(stallTimer);
      if (offset + chunk.byteLength > part.length) {
        throw new Error("The range response is longer than requested");
      }
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
      await limiter.take(chunk.byteLength);
      stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    }
  } finally {
    clearTimeout(stallTimer);
  }

  if (offset !== part.length) {
    throw new Error(`The range response ended after ${offset} of ${part.length} bytes`);
  }

  return buffer;
};

const createThrottledBody = ({
  buffer,
  limiter,
  onSent,
}: {
  buffer: Buffer;
  limiter: RateLimiter;
  onSent: (bytes: number) => void;
}) =>
  Readable.from(
    (async function* () {
      for (let offset = 0; offset < buffer.byteLength; offset += UPLOAD_CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, offset + UPLOAD_CHUNK_SIZE);
        await limiter.take(chunk.byteLength);
        onSent(chunk.byteLength);
        yield chunk;
      }
    })(),
  );

export const uploadArchive = async ({
  bucket,
  client,
  downloadLimiter,
  key,
  onProgress,
  onStart,
  partClient,
  partSize = PART_SIZE,
  sleep = (ms: number) => Bun.sleep(ms),
  source,
  stateDir,
  uploadLimiter,
}: {
  bucket: string;
  client: S3Client;
  downloadLimiter: RateLimiter;
  key: string;
  onProgress: (bytesDelta: number) => void;
  onStart: (status: { completedBytes: number; completedParts: number; totalParts: number }) => void;
  partClient: S3Client;
  partSize?: number;
  sleep?: (ms: number) => Promise<void>;
  source: { etag: string; size: number; url: string };
  stateDir: string;
  uploadLimiter: RateLimiter;
}) => {
  const statePath = getUploadStatePath({ bucket, key, stateDir });
  const parts = planParts({ partSize, size: source.size });
  const expected: Omit<UploadState, "uploadId"> = {
    bucket,
    key,
    partSize,
    size: source.size,
    sourceEtag: source.etag,
    sourceUrl: source.url,
  };
  let state = await readUploadState(statePath);
  let uploaded = new Map<number, { etag: string; size: number }>();

  if (
    state &&
    Object.entries(expected).some(([field, value]) => state?.[field as keyof UploadState] !== value)
  ) {
    await tryCatch(
      client.send(
        new AbortMultipartUploadCommand({
          Bucket: state.bucket,
          Key: state.key,
          UploadId: state.uploadId,
        }),
      ),
    );
    console.log(`Discarded the saved upload of ${state.sourceUrl}; it does not match this build`);
    state = null;
  }

  if (state) {
    const listed = await tryCatch(listUploadedParts({ client, state }));

    if (listed.error) {
      if (listed.error.name !== "NoSuchUpload") {
        throw listed.error;
      }
      state = null;
    } else {
      uploaded = listed.data;
    }
  }

  if (!state) {
    const cleaned = await tryCatch(abortUnfinishedUploads({ bucket, client, key }));

    if (cleaned.error) {
      console.warn(`Could not remove stale multipart uploads for ${key}: ${cleaned.error.message}`);
    }

    const created = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: "application/octet-stream",
      }),
    );

    if (!created.UploadId) {
      throw new Error("Map storage did not return a multipart upload ID");
    }

    state = { ...expected, uploadId: created.UploadId };
    await writeUploadState(statePath, state);
  }

  const activeState = state;
  const completed = new Map<number, string>();

  for (const part of parts) {
    const existing = uploaded.get(part.partNumber);
    if (existing && existing.size === part.length) {
      completed.set(part.partNumber, existing.etag);
    }
  }

  const pending = parts.filter((part) => !completed.has(part.partNumber));
  onStart({
    completedBytes: parts
      .filter((part) => completed.has(part.partNumber))
      .reduce((sum, part) => sum + part.length, 0),
    completedParts: completed.size,
    totalParts: parts.length,
  });

  let nextIndex = 0;
  let failure: Error | null = null;

  const uploadPart = async (part: (typeof parts)[number]) => {
    for (let attempt = 1; ; attempt += 1) {
      let sentBytes = 0;
      const result = await tryCatch(
        (async () => {
          const buffer = await downloadPart({
            etag: source.etag,
            limiter: downloadLimiter,
            part,
            url: source.url,
          });
          const response = await partClient.send(
            new UploadPartCommand({
              Body: createThrottledBody({
                buffer,
                limiter: uploadLimiter,
                onSent: (bytes) => {
                  sentBytes += bytes;
                  onProgress(bytes);
                },
              }),
              Bucket: bucket,
              ContentLength: part.length,
              ContentMD5: createHash("md5").update(buffer).digest("base64"),
              Key: key,
              PartNumber: part.partNumber,
              UploadId: activeState.uploadId,
            }),
          );

          if (!response.ETag) {
            throw new Error(`Map storage did not return an ETag for part ${part.partNumber}`);
          }

          return response.ETag;
        })(),
      );

      if (!result.error) {
        completed.set(part.partNumber, result.data);
        return;
      }

      onProgress(-sentBytes);

      if (attempt >= PART_ATTEMPTS || failure) {
        throw result.error;
      }

      console.warn(
        `Part ${part.partNumber} failed (attempt ${attempt} of ${PART_ATTEMPTS}): ${result.error.message}`,
      );
      await sleep(2 ** attempt * 1000);
    }
  };

  const worker = async () => {
    while (!failure) {
      const part = pending[nextIndex];
      nextIndex += 1;

      if (!part) {
        return;
      }

      const result = await tryCatch(uploadPart(part));

      if (result.error) {
        failure ??= result.error;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (failure) {
    throw failure;
  }

  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: activeState.uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({
          ETag: completed.get(part.partNumber),
          PartNumber: part.partNumber,
        })),
      },
    }),
  );
  await rm(statePath, { force: true });
};
