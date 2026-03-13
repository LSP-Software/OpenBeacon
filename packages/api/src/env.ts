import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

export const env = createEnv({
  server: {
    S3_ENDPOINT: z.url().default("https://s3.us-east-005.backblazeb2.com/"),
    S3_REGION: z.string().default("us-east-005"),
    S3_ACCESS_KEY_ID: z.string(),
    S3_ACCESS_KEY: z.string(),
    S3_BUCKET_NAME: z.string(),
    S3_CDN_URL: z.url().default("https://cdn.openbeacon.net/file"),
    MAX_IMAGE_FILE_SIZE: z.coerce.number().default(5242880),
  },
  runtimeEnv: process.env,
});
