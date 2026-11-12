import { envSchema as apiEnvSchema } from "@openbeacon/api/envSchema.ts";
import { emailEnvSchema, findEmailSettingsError } from "@openbeacon/email/config.ts";
import { validateEnv } from "@openbeacon/shared";
import { envSchema as backendEnvSchema } from "./envSchema.ts";

validateEnv({
  schemas: { ...backendEnvSchema, ...apiEnvSchema, ...emailEnvSchema },
  source: process.env,
  checks: [
    () =>
      process.env["TRUSTED_PROXY_PROVIDER"] === "cloudflare-authenticated" &&
      !process.env["CLOUDFLARE_ORIGIN_SECRET"]
        ? "CLOUDFLARE_ORIGIN_SECRET: required for cloudflare-authenticated"
        : null,
    () =>
      Boolean(process.env["GOOGLE_CLIENT_ID"]?.trim()) !==
      Boolean(process.env["GOOGLE_CLIENT_SECRET"]?.trim())
        ? "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET: both are required for Google sign-in"
        : null,
    () => {
      const emailError = findEmailSettingsError();
      return emailError ? `Email: ${emailError}` : null;
    },
  ],
});
