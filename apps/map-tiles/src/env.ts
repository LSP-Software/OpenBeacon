import { ARCHIVE_GRACE_PERIOD_MS, SLOT_REUSE_MARGIN_MS } from "@openbeacon/map-tiles";
import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;

const blankAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const portSchema = z.preprocess(
  blankAsUndefined,
  z.coerce.number().int().min(1).max(65_535).default(8080),
);

const envSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  MAP_TILES_MAX_MBPS: z.preprocess(blankAsUndefined, z.coerce.number().positive().optional()),
  MAP_TILES_STATE_DIR: z.preprocess(blankAsUndefined, z.string().trim().default(".map-tiles")),
  MAP_TILES_API_KEY: z.preprocess(blankAsUndefined, z.string().min(32).optional()),
  MAP_TILES_PORT: portSchema,
  MAP_TILES_UPDATE_INTERVAL_DAYS: z.preprocess(
    blankAsUndefined,
    z.coerce
      .number()
      .positive()
      .default(30)
      .refine((days) => days * DAY_MS > ARCHIVE_GRACE_PERIOD_MS + SLOT_REUSE_MARGIN_MS, {
        message: `must be longer than the ${(ARCHIVE_GRACE_PERIOD_MS + SLOT_REUSE_MARGIN_MS) / DAY_MS} days a replaced map is kept in use`,
      }),
  ),
});

export const parseEnv = (source: Record<string, string | undefined>) => {
  const env = envSchema.parse(source);

  return {
    ...env,
    maxBytesPerSecond:
      env.MAP_TILES_MAX_MBPS === undefined ? null : (env.MAP_TILES_MAX_MBPS * 1_000_000) / 8,
    updateIntervalMs: env.MAP_TILES_UPDATE_INTERVAL_DAYS * DAY_MS,
  };
};

const clientEnvSchema = z.object({
  MAP_TILES_API_KEY: z.string().min(32),
  MAP_TILES_PORT: portSchema,
  MAP_TILES_SERVICE_URL: z.preprocess(blankAsUndefined, z.url({ protocol: /^https?$/ }).optional()),
});

export const parseClientEnv = (source: Record<string, string | undefined>) => {
  const result = clientEnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`The map-tiles command needs:\n${z.prettifyError(result.error)}`);
  }

  const env = result.data;

  return {
    apiKey: env.MAP_TILES_API_KEY,
    serviceUrl: env.MAP_TILES_SERVICE_URL ?? `http://127.0.0.1:${env.MAP_TILES_PORT}`,
  };
};

export type MapTilesEnv = ReturnType<typeof parseEnv>;
