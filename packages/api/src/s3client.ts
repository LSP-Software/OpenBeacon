import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { env } from "./env.ts";

export const createStorageClient = (
  config: S3ClientConfig,
  timeouts = { connectionTimeout: 5_000, requestTimeout: 15_000 },
) => new S3Client({ ...config, requestHandler: { ...timeouts, throwOnRequestTimeout: true } });

export const s3Client = createStorageClient({
  endpoint: env.IMAGES_S3_ENDPOINT,
  region: env.IMAGES_S3_REGION,
  forcePathStyle: env.IMAGES_S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.IMAGES_S3_ACCESS_KEY_ID,
    secretAccessKey: env.IMAGES_S3_ACCESS_KEY,
  },
});
