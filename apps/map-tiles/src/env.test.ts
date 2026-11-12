import { describe, expect, test } from "bun:test";
import { parseEnv } from "./env.ts";

const required = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
};

describe("parseEnv", () => {
  test("has no bandwidth limit when MAP_TILES_MAX_MBPS is unset or blank", () => {
    expect(parseEnv(required).maxBytesPerSecond).toBeNull();
    expect(parseEnv({ ...required, MAP_TILES_MAX_MBPS: " " }).maxBytesPerSecond).toBeNull();
  });

  test("converts megabits per second to bytes per second", () => {
    expect(parseEnv({ ...required, MAP_TILES_MAX_MBPS: "20" }).maxBytesPerSecond).toBe(2_500_000);
    expect(parseEnv({ ...required, MAP_TILES_MAX_MBPS: "0.8" }).maxBytesPerSecond).toBe(100_000);
  });

  test("rejects invalid bandwidth limits", () => {
    expect(() => parseEnv({ ...required, MAP_TILES_MAX_MBPS: "0" })).toThrow();
    expect(() => parseEnv({ ...required, MAP_TILES_MAX_MBPS: "fast" })).toThrow();
  });

  test("defaults the state directory when it is unset or blank", () => {
    expect(parseEnv(required).MAP_TILES_STATE_DIR).toBe(".map-tiles");
    expect(parseEnv({ ...required, MAP_TILES_STATE_DIR: "" }).MAP_TILES_STATE_DIR).toBe(
      ".map-tiles",
    );
    expect(parseEnv({ ...required, MAP_TILES_STATE_DIR: "/state" }).MAP_TILES_STATE_DIR).toBe(
      "/state",
    );
  });

  test("only allows update intervals longer than a replaced map stays in use", () => {
    expect(parseEnv(required).updateIntervalMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(() => parseEnv({ ...required, MAP_TILES_UPDATE_INTERVAL_DAYS: "8" })).toThrow();
    expect(parseEnv({ ...required, MAP_TILES_UPDATE_INTERVAL_DAYS: "9" }).updateIntervalMs).toBe(
      9 * 24 * 60 * 60 * 1000,
    );
  });

  test("requires a long service key when one is set", () => {
    expect(parseEnv({ ...required, MAP_TILES_API_KEY: "" }).MAP_TILES_API_KEY).toBeUndefined();
    expect(() => parseEnv({ ...required, MAP_TILES_API_KEY: "short" })).toThrow();
  });
});
