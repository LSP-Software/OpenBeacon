import { ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { checkMapArchive, runStorageCheck } from "@openbeacon/map-tiles";
import { env } from "./env.ts";
import { mapStorageClient } from "./mapStorage.ts";
import { s3Client } from "./s3client.ts";

export const checkImageStorage = () =>
  runStorageCheck({
    label: "Image storage",
    prefix: "IMAGES_S3",
    forcePathStyle: env.IMAGES_S3_FORCE_PATH_STYLE,
    check: () =>
      s3Client.send(
        new ListObjectVersionsCommand({ Bucket: env.IMAGES_S3_BUCKET_NAME, MaxKeys: 1 }),
        { abortSignal: AbortSignal.timeout(10000) },
      ),
  });

export const checkMapStorage = () =>
  runStorageCheck({
    label: "Map storage",
    prefix: "MAP_S3",
    forcePathStyle: env.MAP_S3_FORCE_PATH_STYLE,
    check: () => checkMapArchive({ bucket: env.MAP_S3_BUCKET_NAME, client: mapStorageClient }),
  });
