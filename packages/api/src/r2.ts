import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.ts";

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export const PM_TILES_URL_EXPIRES_IN_SECONDS = 60 * 10;

export async function createSignedPmtilesUrl() {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: env.R2_PM_TILES_KEY,
  });

  const url = await getSignedUrl(r2Client, command, {
    expiresIn: PM_TILES_URL_EXPIRES_IN_SECONDS,
  });

  const expiresAt = new Date(Date.now() + PM_TILES_URL_EXPIRES_IN_SECONDS * 1000).toISOString();

  return {
    url,
    expiresAt,
  };
}
