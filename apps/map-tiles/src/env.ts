import { z } from "zod";

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
});

export const parseEnv = (source: Record<string, string | undefined>) => {
  const env = envSchema.parse(source);

  return {
    ...env,
    maxBytesPerSecond:
      env.MAP_TILES_MAX_MBPS === undefined ? null : (env.MAP_TILES_MAX_MBPS * 1_000_000) / 8,
  };
};

export type MapTilesEnv = ReturnType<typeof parseEnv>;
