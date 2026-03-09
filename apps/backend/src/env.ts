import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
export const env = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
  },
  runtimeEnv: process.env,
});
