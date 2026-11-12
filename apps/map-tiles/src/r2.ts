import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { tryCatch } from "@openbeacon/shared";
import type { MapTilesEnv } from "./env.ts";

export const createR2Clients = (env: MapTilesEnv) => {
  const config = {
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { connectionTimeout: 30_000, requestTimeout: 120_000 },
  } as const;

  return {
    client: new S3Client(config),
    // A streamed part body cannot be replayed, so SDK retries are disabled and the uploader retries whole parts.
    partClient: new S3Client({ ...config, maxAttempts: 1 }),
  };
};

export const headObject = async ({
  bucket,
  client,
  key,
}: {
  bucket: string;
  client: S3Client;
  key: string;
}) => {
  const result = await tryCatch(client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })));

  if (result.error) {
    if (result.error.name === "NotFound" || result.error.name === "NoSuchKey") {
      return null;
    }
    throw result.error;
  }

  return { size: result.data.ContentLength ?? 0 };
};

export const readObjectRange = async ({
  bucket,
  client,
  key,
  length,
  start,
}: {
  bucket: string;
  client: S3Client;
  key: string;
  length: number;
  start: number;
}) => {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=${start}-${start + length - 1}`,
    }),
  );

  if (!response.Body) {
    throw new Error(`Reading ${key} from R2 returned no body`);
  }

  return response.Body.transformToByteArray();
};

export const checkBucketAccess = async ({
  bucket,
  client,
}: {
  bucket: string;
  client: S3Client;
}) => {
  const options = { abortSignal: AbortSignal.timeout(10_000) };
  const key = "map-tiles-access-check";

  await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }), options);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "ok" }), options);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), options);
};
