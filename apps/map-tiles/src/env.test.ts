import { describe, expect, test } from "bun:test";
import { parseClientEnv, parseEnv } from "./env.ts";

const required = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
  MAP_TILES_API_KEY: "k".repeat(32),
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

  test("requires a long service key", () => {
    expect(() => parseEnv({ ...required, MAP_TILES_API_KEY: "" })).toThrow();
    expect(() => parseEnv({ ...required, MAP_TILES_API_KEY: "short" })).toThrow();
  });
});

describe("parseClientEnv", () => {
  const apiKey = "k".repeat(40);

  test("talks to the service in the same container by default", () => {
    expect(parseClientEnv({ MAP_TILES_API_KEY: apiKey })).toEqual({
      apiKey,
      serviceUrl: "http://127.0.0.1:8080",
    });
    expect(parseClientEnv({ MAP_TILES_API_KEY: apiKey, MAP_TILES_PORT: "9000" }).serviceUrl).toBe(
      "http://127.0.0.1:9000",
    );
  });

  test("can reach a service elsewhere", () => {
    expect(
      parseClientEnv({
        MAP_TILES_API_KEY: apiKey,
        MAP_TILES_SERVICE_URL: "https://maps.example",
      }).serviceUrl,
    ).toBe("https://maps.example");
  });

  test("needs the service key", () => {
    expect(() => parseClientEnv({})).toThrow();
    expect(() => parseClientEnv({ MAP_TILES_API_KEY: "short" })).toThrow();
  });
});
