import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { env } from "./env.ts";

export const createStorageClient = (
  config: S3ClientConfig,
  timeouts = { connectionTimeout: 5_000, requestTimeout: 15_000 },
) => new S3Client({ ...config, requestHandler: { ...timeouts, throwOnRequestTimeout: true } });

const imagesConfig = {
  region: env.IMAGES_S3_REGION,
  forcePathStyle: env.IMAGES_S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.IMAGES_S3_ACCESS_KEY_ID,
    secretAccessKey: env.IMAGES_S3_ACCESS_KEY,
  },
};

export const s3Client = createStorageClient({ ...imagesConfig, endpoint: env.IMAGES_S3_ENDPOINT });

export const s3PresignClient = env.IMAGES_S3_PUBLIC_ENDPOINT
  ? createStorageClient({ ...imagesConfig, endpoint: env.IMAGES_S3_PUBLIC_ENDPOINT })
  : s3Client;
