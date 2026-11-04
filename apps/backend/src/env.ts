import { createEnv } from "@t3-oss/env-core";
import { envSchema } from "./envSchema.ts";

export const env = createEnv({ server: envSchema, runtimeEnv: process.env });

if (env.TRUSTED_PROXY_PROVIDER === "cloudflare-authenticated" && !env.CLOUDFLARE_ORIGIN_SECRET) {
  throw new Error("CLOUDFLARE_ORIGIN_SECRET is required for cloudflare-authenticated");
}
