import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.ts";
import { tryCatch } from "./tryCatch.ts";

let storageClient: S3Client | null = null;

const getStorageClient = (): S3Client => {
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
};

export const verifyStorageConnectivity = async (): Promise<void> => {
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
      const statusCode = (result.error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      throw new Error(
        `Failed to connect to S3 at ${env.S3_ENDPOINT}. S3 endpoint returned an error the SDK could not interpret (often seen with S3-compatible backends like B2 or MinIO). Check endpoint, bucket, region, and credentials. HTTP status code: ${statusCode ?? "unknown"}`,
      );
    }
    throw new Error(
      `Failed to connect to S3 at ${env.S3_ENDPOINT}: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
    );
  }
  console.log("S3 bucket connected successfully.");
};

const buildKey = (prefix: string, fileName: string): string => {
  return prefix ? `${prefix}/${fileName}` : fileName;
};

export const getPresignedUploadUrl = async (
  prefix: string,
  fileName: string,
  contentType: string,
  contentHash: string,
): Promise<string> => {
  const client = getStorageClient();
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: buildKey(prefix, fileName),
    ContentType: contentType,
    ChecksumSHA256: contentHash,
  });
  return getSignedUrl(client, command, {
    expiresIn: 60,
    signableHeaders: new Set(["x-amz-checksum-sha256"]),
    unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
  });
};

export const getFileSize = async (prefix: string, fileName: string): Promise<number | null> => {
  const client = getStorageClient();
  const command = new HeadObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: buildKey(prefix, fileName),
  });
  const { data: response, error: responseError } = await tryCatch(client.send(command));
  if (responseError) {
    const name = (responseError as { name?: string }).name ?? "";
    if (name === "NotFound" || name === "NoSuchKey") return null;
    throw responseError;
  }
  if (response.$metadata.httpStatusCode !== 200) return null;
  return response.ContentLength ?? null;
};

export const deleteFile = async (
  bucketName: string,
  prefix: string,
  fileName: string,
): Promise<void> => {
  const client = getStorageClient();
  const key = buildKey(prefix, fileName);

  const listResult = await tryCatch(
    client.send(
      new ListObjectVersionsCommand({
        Bucket: bucketName,
        Prefix: key,
      }),
    ),
  );

  if (listResult.error) {
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    return;
  }

  const objectsToDelete: { Key: string; VersionId: string }[] = [];

  for (const version of listResult.data.Versions ?? []) {
    if (version.Key === key && version.VersionId) {
      objectsToDelete.push({ Key: key, VersionId: version.VersionId });
    }
  }

  for (const marker of listResult.data.DeleteMarkers ?? []) {
    if (marker.Key === key && marker.VersionId) {
      objectsToDelete.push({ Key: key, VersionId: marker.VersionId });
    }
  }

  if (objectsToDelete.length === 0) {
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    return;
  }

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: { Objects: objectsToDelete },
    }),
  );
};

export const buildPublicUrl = (prefix: string, fileName: string): string => {
  const key = buildKey(prefix, fileName);
  return `${env.S3_CDN_URL}/${env.S3_BUCKET_NAME}/${key}`;
};

export const extractStorageKey = (
  imageUrl: string,
): { prefix: string; fileName: string } | null => {
  const baseUrl = `${env.S3_CDN_URL}/${env.S3_BUCKET_NAME}`;
  if (!imageUrl?.startsWith(baseUrl)) return null;

  const path = imageUrl.slice(baseUrl.length + 1);
  if (!path) return null;

  const slashIndex = path.indexOf("/");
  if (slashIndex === -1) return { prefix: "", fileName: path };

  return {
    prefix: path.slice(0, slashIndex),
    fileName: path.slice(slashIndex + 1),
  };
};
