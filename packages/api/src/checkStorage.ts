import { ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { checkMapArchive } from "@openbeacon/map-tiles";
import { env } from "./env.ts";
import { r2Client } from "./r2.ts";
import { s3Client } from "./s3client.ts";

export const checkS3 = async () => {
  await s3Client.send(new ListObjectVersionsCommand({ Bucket: env.S3_BUCKET_NAME, MaxKeys: 1 }), {
    abortSignal: AbortSignal.timeout(10000),
  });
};

export const checkR2 = () => checkMapArchive({ bucket: env.R2_BUCKET, client: r2Client });
