import { ARCHIVE_GRACE_PERIOD_MS, SLOT_REUSE_MARGIN_MS } from "@openbeacon/map-tiles";
import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;

const blankAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const envSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PM_TILES_KEY: z.preprocess(blankAsUndefined, z.string().optional()),
  MAP_TILES_MAX_MBPS: z.preprocess(blankAsUndefined, z.coerce.number().positive().optional()),
  MAP_TILES_STATE_DIR: z.preprocess(blankAsUndefined, z.string().trim().default(".map-tiles")),
  MAP_TILES_API_KEY: z.preprocess(blankAsUndefined, z.string().min(32).optional()),
  MAP_TILES_PORT: z.preprocess(
    blankAsUndefined,
    z.coerce.number().int().min(1).max(65_535).default(8080),
  ),
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

export type MapTilesEnv = ReturnType<typeof parseEnv>;
