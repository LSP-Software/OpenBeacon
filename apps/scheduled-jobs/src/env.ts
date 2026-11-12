import { findEmailSettingsError } from "@openbeacon/email/config.ts";

const databaseUrl = process.env["DATABASE_URL"];

if (
  !databaseUrl ||
  !URL.canParse(databaseUrl) ||
  !["postgres:", "postgresql:"].includes(new URL(databaseUrl).protocol)
) {
  throw new Error("DATABASE_URL must be a postgres:// or postgresql:// URL");
}

const emailError = findEmailSettingsError();
if (emailError) {
  console.error(`  Email: ${emailError}`);
  throw new Error("Environment configuration validation failed");
}
