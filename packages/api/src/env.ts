import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    S3_ENDPOINT: z.url().default("https://s3.us-east-005.backblazeb2.com"),
    S3_REGION: z.string().default("us-east-005"),
    S3_ACCESS_KEY_ID: z.string().min(20),
    S3_ACCESS_KEY: z.string().min(20),
    S3_BUCKET_NAME: z.string().min(1),
    S3_CDN_URL: z
      .string()
      .url()
      .default("https://cdn.openbeacon.net/file")
      .transform((url) => url.replace(/\/+$/, "")),
    MAX_IMAGE_FILE_SIZE: z.coerce.number().default(5242880),
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    R2_PM_TILES_KEY: z.string().min(1),
  },
  runtimeEnv: process.env,
});
