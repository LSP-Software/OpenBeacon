import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    CACHE_PREFIX: z.string().min(1).default("openbeacon"),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
