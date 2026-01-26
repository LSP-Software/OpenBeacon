import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
