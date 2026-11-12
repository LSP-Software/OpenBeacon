import { envSchema as apiEnvSchema } from "@openbeacon/api/envSchema.ts";
import { databaseUrlSchema } from "@openbeacon/database/databaseUrlSchema.ts";
import { emailEnvSchema, findEmailSettingsError } from "@openbeacon/email/config.ts";
import { validateEnv } from "@openbeacon/shared";

validateEnv({
  schemas: { DATABASE_URL: databaseUrlSchema, ...apiEnvSchema, ...emailEnvSchema },
  source: process.env,
  checks: [
    () => {
      const emailError = findEmailSettingsError();
      return emailError ? `Email: ${emailError}` : null;
    },
  ],
});
