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

const mapTilesServiceUrl = process.env["MAP_TILES_SERVICE_URL"];
const mapTilesApiKey = process.env["MAP_TILES_API_KEY"];

if (Boolean(mapTilesServiceUrl) !== Boolean(mapTilesApiKey)) {
  throw new Error("Set both MAP_TILES_SERVICE_URL and MAP_TILES_API_KEY, or neither");
}

if (
  mapTilesServiceUrl &&
  (!URL.canParse(mapTilesServiceUrl) ||
    !["http:", "https:"].includes(new URL(mapTilesServiceUrl).protocol))
) {
  throw new Error("MAP_TILES_SERVICE_URL must be an http:// or https:// URL");
}

if (mapTilesApiKey && mapTilesApiKey.length < 32) {
  throw new Error("MAP_TILES_API_KEY must be at least 32 characters");
}
