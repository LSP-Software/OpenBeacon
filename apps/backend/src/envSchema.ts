import { redisUrlSchema } from "@openbeacon/cache";
import { optionalEnvString } from "@openbeacon/schemas";
import { z } from "zod";

export const envSchema = {
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  GOOGLE_CLIENT_ID: optionalEnvString,
  GOOGLE_CLIENT_SECRET: optionalEnvString,
  DATABASE_URL: z
    .url()
    .refine(
      (value) =>
        URL.canParse(value) && ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      {
        message: "DATABASE_URL must use postgres:// or postgresql://",
      },
    ),
  REDIS_URL: redisUrlSchema,
  OPENBEACON_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OPENBEACON_API_HOSTNAME: z.ipv4().default("0.0.0.0"),
  TRUSTED_PROXY_PROVIDER: z
    .enum(["none", "cloudflare", "cloudflare-authenticated", "trusted-proxy"])
    .default("none"),
  CLOUDFLARE_ORIGIN_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(32).optional(),
  ),
};
