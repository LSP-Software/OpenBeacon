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

const deleteImageVersions = async (bucketName: string, key: string, exact: boolean) => {
  const objects: { Key: string; VersionId: string }[] = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectVersionsCommand({
        Bucket: bucketName,
        Prefix: key,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );
    for (const object of [...(response.Versions ?? []), ...(response.DeleteMarkers ?? [])]) {
      if (!object.Key || !object.Key.startsWith(key) || !object.VersionId) {
        throw new Error("Storage returned an invalid image version.");
      }
      if (!exact || object.Key === key)
        objects.push({ Key: object.Key, VersionId: object.VersionId });
    }
    if (response.IsTruncated && !response.NextKeyMarker) {
      throw new Error("Storage did not return a continuation marker.");
    }
    keyMarker = response.IsTruncated ? response.NextKeyMarker : undefined;
    versionIdMarker = response.IsTruncated ? response.NextVersionIdMarker : undefined;
  } while (keyMarker);

  if (exact && objects.length === 0) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    return;
  }

  for (let index = 0; index < objects.length; index += 1000) {
    const response = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: objects.slice(index, index + 1000) },
      }),
    );
    if (response.Errors?.length)
      throw new Error("Failed to delete all image versions from storage.");
  }
};

export const deleteFile = async (
  bucketName: string,
  path: string,
  fileName: string,
): Promise<void> => deleteImageVersions(bucketName, buildKey(path, fileName), true);

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

export const deleteUserImages = async (bucketName: string, userId: string): Promise<void> => {
  if (!userId || userId.includes("/")) throw new Error("Invalid user ID.");
  await deleteImageVersions(bucketName, `user/${userId}/`, false);
};

export const deleteImageKey = async (bucketName: string, key: string): Promise<void> => {
  if (!key || key.startsWith("/")) throw new Error("Invalid image key.");
  await deleteImageVersions(bucketName, key, true);
};
