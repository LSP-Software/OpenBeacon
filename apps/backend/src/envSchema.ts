import { redisHashSecretSchema, redisUrlSchema } from "@openbeacon/cache";
import { databaseUrlSchema } from "@openbeacon/database/databaseUrlSchema.ts";
import { optionalEnvString, serverNameSchema } from "@openbeacon/schemas";
import { z } from "zod";

export const envSchema = {
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  GOOGLE_CLIENT_ID: optionalEnvString,
  GOOGLE_CLIENT_SECRET: optionalEnvString,
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  REDIS_HASH_SECRET: redisHashSecretSchema,
  SERVER_NAME: serverNameSchema,
  SELF_HOSTED: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.stringbool().default(true),
  ),
  EMAIL_CODE_IP_LIMIT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.stringbool().default(false),
  ),
  OPENBEACON_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OPENBEACON_API_HOSTNAME: z.ipv4().default("0.0.0.0"),
  TRUSTED_PROXY_PROVIDER: z
    .enum(["none", "cloudflare", "cloudflare-authenticated", "trusted-proxy"])
    .default("none"),
  DISCORD_FEEDBACK_WEBHOOK_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .url({
        protocol: /^https$/,
        hostname: /^(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)$/,
      })
      .refine(
        (value) => {
          const url = URL.parse(value);
          return (
            url !== null &&
            url.port === "" &&
            url.username === "" &&
            url.password === "" &&
            url.pathname.startsWith("/api/webhooks/")
          );
        },
        { message: "DISCORD_FEEDBACK_WEBHOOK_URL must be a Discord webhook URL" },
      )
      .optional(),
  ),
  CLOUDFLARE_ORIGIN_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(32).optional(),
  ),
};
