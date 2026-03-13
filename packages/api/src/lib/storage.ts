import {
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.ts";
import { tryCatch } from "./tryCatch.ts";

let storageClient: S3Client | null = null;

function getStorageClient(): S3Client {
  if (!storageClient) {
    storageClient = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_ACCESS_KEY,
      },
    });
  }
  return storageClient;
}

export async function verifyStorageConnectivity(): Promise<void> {
  const client = getStorageClient();
  console.log("Verifying storage connectivity...");
  console.log("Bucket name:", env.S3_BUCKET_NAME);
  console.log("Endpoint:", env.S3_ENDPOINT);
  console.log("Region:", env.S3_REGION);
  const result = await tryCatch(client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET_NAME })));
  if (result.error) {

    const name = (result.error as Error & { name?: string }).name ?? "";

    if (name === "NotFound" || name === "NoSuchBucket") {
      throw new Error(`S3 bucket "${env.S3_BUCKET_NAME}" does not exist at ${env.S3_ENDPOINT}`);
    }
    if (name === "CredentialsProviderError" || name === "InvalidAccessKeyId") {
      throw new Error(
        `S3 credentials rejected by ${env.S3_ENDPOINT} — verify S3_ACCESS_KEY_ID and S3_ACCESS_KEY`,
      );
    }
    if (name === "AccessDenied" || name === "Forbidden") {
      throw new Error(
        `S3 access denied to bucket "${env.S3_BUCKET_NAME}" — ensure the credentials have permission to access this bucket`,
      );
    }
    if (name === "Unknown") {
      const statusCode = (result.error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      throw new Error(`Failed to connect to S3 at ${env.S3_ENDPOINT}. S3 endpoint returned an error the SDK could not interpret (often seen with S3-compatible backends like B2 or MinIO). Check endpoint, bucket, region, and credentials. HTTP status code: ${statusCode ?? "unknown"}`);
    }
    throw new Error(
      `Failed to connect to S3 at ${env.S3_ENDPOINT}: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
    );
  }
  console.log("S3 bucket connected successfully.");
}

function buildKey(prefix: string, fileName: string): string {
  return `${prefix}/${fileName}`;
}

export async function getPresignedUploadUrl(
  prefix: string,
  fileName: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  const client = getStorageClient();
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: buildKey(prefix, fileName),
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

export async function verifyFileExists(prefix: string, fileName: string): Promise<boolean> {
  const client = getStorageClient();
  const command = new HeadObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: buildKey(prefix, fileName),
  });
  const response = await client.send(command);
  return response.$metadata.httpStatusCode === 200;
}

export async function deleteFile(prefix: string, fileName: string): Promise<void> {
  const client = getStorageClient();
  const command = new DeleteObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: buildKey(prefix, fileName),
  });
  await client.send(command);
}

export function buildPublicUrl(prefix: string, fileName: string): string {
  const version = Date.now();
  return `${env.S3_CDN_URL}/${prefix}/${fileName}?v=${version}`;
}

export function extractStorageKey(imageUrl: string): { prefix: string; fileName: string } | null {
  const cdnUrl = env.S3_CDN_URL;
  const urlWithoutQuery = imageUrl.split("?")[0];
  if (!urlWithoutQuery?.startsWith(cdnUrl)) return null;

  const path = urlWithoutQuery.slice(cdnUrl.length + 1);
  const slashIndex = path.indexOf("/");
  if (slashIndex === -1) return null;

  return {
    prefix: path.slice(0, slashIndex),
    fileName: path.slice(slashIndex + 1),
  };
}
