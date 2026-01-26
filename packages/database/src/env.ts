import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DATABASE_SSL: z.coerce.boolean().default(false),
    DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
    DATABASE_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
    DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(10),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
