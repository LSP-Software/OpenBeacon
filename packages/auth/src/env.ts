import { redisHashSecretSchema } from "@openbeacon/cache";
import { optionalEnvString } from "@openbeacon/schemas";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
    BETTER_AUTH_SECRET: z.string().min(32),
    REDIS_HASH_SECRET: redisHashSecretSchema,
    GOOGLE_CLIENT_ID: optionalEnvString,
    GOOGLE_CLIENT_SECRET: optionalEnvString,
  },
  runtimeEnv: process.env,
});
