import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { tryCatch } from "@openbeacon/shared";
import { env } from "../env.ts";
import { s3Client } from "../s3client.ts";

const buildKey = (path: string, fileName: string): string => {
  return path ? `${path}/${fileName}` : fileName;
};

export const getPresignedUploadUrl = async (
  bucketName: string,
  path: string,
  fileName: string,
  contentType: string,
  contentHash: string,
  contentSize: number,
): Promise<string> => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: buildKey(path, fileName),
    ContentType: contentType,
    ChecksumSHA256: contentHash,
    ContentLength: contentSize,
  });
  return getSignedUrl(s3Client, command, {
    expiresIn: 300,
    signableHeaders: new Set(["x-amz-checksum-sha256"]),
    unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
  });
};

export const getFileSize = async (
  bucketName: string,
  path: string,
  fileName: string,
): Promise<number | null> => {
  const command = new HeadObjectCommand({
    Bucket: bucketName,
    Key: buildKey(path, fileName),
  });
  const { data: response, error: responseError } = await tryCatch(s3Client.send(command));
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
  const key = buildKey(path, fileName);

  const listResult = await tryCatch(
    s3Client.send(
      new ListObjectVersionsCommand({
        Bucket: bucketName,
        Prefix: key,
      }),
    ),
  );

  if (listResult.error) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
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
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    return;
  }

  await s3Client.send(
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

  const lastSlashIndex = key.lastIndexOf("/");
  if (lastSlashIndex === -1) {
    return { bucketName, path: "", fileName: key };
  }

  return {
    bucketName,
    path: key.slice(0, lastSlashIndex),
    fileName: key.slice(lastSlashIndex + 1),
  };
};
