import { ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { checkMapArchive } from "@openbeacon/map-tiles";
import { env } from "./env.ts";
import { mapStorageClient } from "./mapStorage.ts";
import { s3Client } from "./s3client.ts";

export const checkImageStorage = async () => {
  await s3Client.send(
    new ListObjectVersionsCommand({ Bucket: env.IMAGES_S3_BUCKET_NAME, MaxKeys: 1 }),
    {
      abortSignal: AbortSignal.timeout(10000),
    },
  );
};

export const checkMapStorage = () =>
  checkMapArchive({ bucket: env.MAP_S3_BUCKET_NAME, client: mapStorageClient });
