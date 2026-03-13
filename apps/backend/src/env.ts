import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
export const env = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    OPENBEACON_API_PORT: z.coerce.number().min(1).max(65535).default(3000),
    OPENBEACON_API_HOSTNAME: z.ipv4().default("0.0.0.0"),
    S3_ENDPOINT: z.url().default("https://s3.us-east-005.backblazeb2.com"),
    S3_REGION: z.string().default("us-east-005"),
    S3_ACCESS_KEY_ID: z.string(),
    S3_ACCESS_KEY: z.string(),
    S3_BUCKET_NAME: z.string(),
    S3_CDN_URL: z.url().default("https://cdn.openbeacon.net/file"),
    MAX_IMAGE_FILE_SIZE: z.coerce.number().default(5242880),
    MAX_IMAGE_RESOLUTION: z.coerce.number().default(512),
  },
  runtimeEnv: process.env,
});
