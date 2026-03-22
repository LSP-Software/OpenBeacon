import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const optionalEnvString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}, z.string().min(1).optional());

export const env = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: optionalEnvString,
    GOOGLE_CLIENT_SECRET: optionalEnvString,
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    OPENBEACON_API_PORT: z.coerce.number().min(1).max(65535).default(3000),
    OPENBEACON_API_HOSTNAME: z.ipv4().default("0.0.0.0"),
  },
  runtimeEnv: process.env,
});
