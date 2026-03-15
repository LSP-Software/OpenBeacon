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

const verifyStorageBucketConnectivity = async (
  bucketName: string,
  storageLabel: string,
): Promise<void> => {
  const client = getStorageClient();

  console.log(`Verifying ${storageLabel} storage connectivity...`);
  console.log("Bucket name:", bucketName);
  console.log("Endpoint:", env.S3_ENDPOINT);
  console.log("Region:", env.S3_REGION);

  const result = await tryCatch(client.send(new HeadBucketCommand({ Bucket: bucketName })));
  if (result.error) {
    const name = (result.error as Error & { name?: string }).name ?? "";

    if (name === "NotFound" || name === "NoSuchBucket") {
      throw new Error(`S3 bucket "${bucketName}" does not exist at ${env.S3_ENDPOINT}`);
    }
    if (name === "CredentialsProviderError" || name === "InvalidAccessKeyId") {
      throw new Error(
        `S3 credentials rejected by ${env.S3_ENDPOINT} — verify S3_ACCESS_KEY_ID and S3_ACCESS_KEY`,
      );
    }
    if (name === "AccessDenied" || name === "Forbidden") {
      throw new Error(
        `S3 access denied to bucket "${bucketName}" — ensure the credentials have permission to access this bucket`,
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
  console.log(`${storageLabel} S3 bucket connected successfully.`);
};

export const verifyStorageConnectivity = async (): Promise<void> => {
  await verifyStorageBucketConnectivity(env.S3_PROFILE_IMAGE_BUCKET_NAME, "profile image");
  await verifyStorageBucketConnectivity(env.S3_GROUP_IMAGE_BUCKET_NAME, "group image");
};

const buildKey = (path: string, fileName: string): string => {
  return path ? `${path}/${fileName}` : fileName;
};

export const getPresignedUploadUrl = async (
  bucketName: string,
  path: string,
  fileName: string,
  contentType: string,
  contentHash: string,
): Promise<string> => {
  const client = getStorageClient();
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: buildKey(path, fileName),
    ContentType: contentType,
    ChecksumSHA256: contentHash,
  });
  return getSignedUrl(client, command, {
    expiresIn: 60,
    signableHeaders: new Set(["x-amz-checksum-sha256"]),
    unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
  });
};

export const getFileSize = async (
  bucketName: string,
  path: string,
  fileName: string,
): Promise<number | null> => {
  const client = getStorageClient();
  const command = new HeadObjectCommand({
    Bucket: bucketName,
    Key: buildKey(path, fileName),
  });
  const { data: response, error: responseError } = await tryCatch(client.send(command));
  if (responseError) {
    const name = (responseError as { name?: string }).name ?? "";
    if (name === "NotFound" || name === "NoSuchKey") return null;
    throw responseError;
  }
  return response.ContentLength ?? null;
};

export const deleteFile = async (
  bucketName: string,
  path: string,
  fileName: string,
): Promise<void> => {
  const client = getStorageClient();
  const key = buildKey(path, fileName);

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

export const buildImagePublicUrl = (bucketName: string, path: string, fileName: string): string => {
  const key = buildKey(path, fileName);
  return `${env.S3_CDN_URL}/${bucketName}/${key}`;
};

export const extractImageStorageObject = (
  imageUrl: string,
): { bucketName: string; path: string; fileName: string } | null => {
  const baseUrl = `${env.S3_CDN_URL}/`;
  if (!imageUrl?.startsWith(baseUrl)) return null;

  const imagePath = imageUrl.slice(baseUrl.length);
  if (!imagePath) return null;

  const firstSlashIndex = imagePath.indexOf("/");
  if (firstSlashIndex === -1) return null;

  const bucketName = imagePath.slice(0, firstSlashIndex);
  const key = imagePath.slice(firstSlashIndex + 1);
  if (!bucketName || !key) return null;

  const slashIndex = key.indexOf("/");
  if (slashIndex === -1) {
    return { bucketName, path: "", fileName: key };
  }

  return {
    bucketName,
    path: key.slice(0, slashIndex),
    fileName: key.slice(slashIndex + 1),
  };
};
