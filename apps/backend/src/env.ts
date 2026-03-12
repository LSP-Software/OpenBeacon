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
    B2_KEY_ID: z.string(),
    B2_APPLICATION_KEY: z.string(),
    B2_BUCKET_ID: z.string(),
    B2_BUCKET_NAME: z.string(),
    B2_PUBLIC_URL: z.url(),
  },
  runtimeEnv: process.env,
});
