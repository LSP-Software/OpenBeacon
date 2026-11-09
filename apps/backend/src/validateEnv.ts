import { envSchema as apiEnvSchema } from "@openbeacon/api/envSchema.ts";
import { emailEnvSchema, loadEmailSettings } from "@openbeacon/email/config.ts";
import { tryCatch } from "@openbeacon/shared";
import { envSchema as backendEnvSchema } from "./envSchema.ts";

const schemas = { ...backendEnvSchema, ...apiEnvSchema, ...emailEnvSchema };
let valid = true;

console.log("Environment configuration:");
for (const [name, schema] of Object.entries(schemas)) {
  const value = process.env[name];
  const result = schema.safeParse(value);
  if (!result.success) {
    valid = false;
    console.error(`  ${name}: invalid`);
  } else {
    console.log(
      `  ${name}: ${value === undefined || value.trim() === "" ? "not set (optional/default)" : "valid"}`,
    );
  }
}

if (
  process.env["TRUSTED_PROXY_PROVIDER"] === "cloudflare-authenticated" &&
  !process.env["CLOUDFLARE_ORIGIN_SECRET"]
) {
  valid = false;
  console.error("  CLOUDFLARE_ORIGIN_SECRET: required for cloudflare-authenticated");
}

if (
  Boolean(process.env["GOOGLE_CLIENT_ID"]?.trim()) !==
  Boolean(process.env["GOOGLE_CLIENT_SECRET"]?.trim())
) {
  valid = false;
  console.error(
    "  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET: both are required for Google sign-in",
  );
}

const emailConfig = await tryCatch(Promise.resolve().then(loadEmailSettings));
if (emailConfig.error) {
  valid = false;
  console.error(`  Email: ${emailConfig.error.message}`);
}

if (!valid) {
  throw new Error("Environment configuration validation failed");
}
console.log("Environment configuration valid");
