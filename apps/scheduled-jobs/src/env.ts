import { envSchema as apiEnvSchema } from "@openbeacon/api/envSchema.ts";
import { redisUrlSchema } from "@openbeacon/cache";
import { databaseUrlSchema } from "@openbeacon/database/databaseUrlSchema.ts";
import {
  emailEnvSchema,
  findEmailSettingsError,
  loadEmailSettings,
} from "@openbeacon/email/config.ts";
import { validateEnv } from "@openbeacon/shared";

validateEnv({
  schemas: { DATABASE_URL: databaseUrlSchema, ...apiEnvSchema, ...emailEnvSchema },
  source: process.env,
  checks: [
    () => {
      const emailError = findEmailSettingsError();
      if (emailError) return `Email: ${emailError}`;
      if (loadEmailSettings().config.transport === "none") return null;
      return redisUrlSchema.safeParse(process.env["REDIS_URL"]).success
        ? null
        : "Email: REDIS_URL must be a redis:// or rediss:// URL when email is on";
    },
  ],
});
