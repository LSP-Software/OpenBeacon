import { redisUrlSchema } from "@openbeacon/cache";
import { optionalEnvString } from "@openbeacon/schemas";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: optionalEnvString,
    GOOGLE_CLIENT_SECRET: optionalEnvString,
    DATABASE_URL: z.url(),
    REDIS_URL: redisUrlSchema,
    OPENBEACON_API_PORT: z.coerce.number().min(1).max(65535).default(3000),
    OPENBEACON_API_HOSTNAME: z.ipv4().default("0.0.0.0"),
    TRUSTED_PROXY_PROVIDER: z
      .enum(["none", "cloudflare", "cloudflare-authenticated", "trusted-proxy"])
      .default("none"),
    CLOUDFLARE_ORIGIN_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32).optional(),
    ),
  },
  runtimeEnv: process.env,
});

if (env.TRUSTED_PROXY_PROVIDER === "cloudflare-authenticated" && !env.CLOUDFLARE_ORIGIN_SECRET) {
  throw new Error("CLOUDFLARE_ORIGIN_SECRET is required for cloudflare-authenticated");
}
