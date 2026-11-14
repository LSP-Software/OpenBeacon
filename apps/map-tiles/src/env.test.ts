import { describe, expect, test } from "bun:test";
import { getServiceUrl, parseEnv } from "./env.ts";

const required = {
  MAP_S3_ENDPOINT: "https://map-storage.example.com",
  MAP_S3_REGION: "us-east-1",
  MAP_S3_ACCESS_KEY_ID: "key",
  MAP_S3_ACCESS_KEY: "secret",
  MAP_S3_BUCKET_NAME: "bucket",
};

describe("parseEnv", () => {
  test("requires the region, with no default provider", () => {
    const { MAP_S3_REGION: _region, ...withoutRegion } = required;
    expect(() => parseEnv(withoutRegion)).toThrow();
    expect(parseEnv(required).MAP_S3_REGION).toBe("us-east-1");
  });

  test("only uses path-style bucket addresses when asked", () => {
    expect(parseEnv(required).MAP_S3_FORCE_PATH_STYLE).toBe(false);
    expect(parseEnv({ ...required, MAP_S3_FORCE_PATH_STYLE: "" }).MAP_S3_FORCE_PATH_STYLE).toBe(
      false,
    );
    expect(parseEnv({ ...required, MAP_S3_FORCE_PATH_STYLE: "true" }).MAP_S3_FORCE_PATH_STYLE).toBe(
      true,
    );
    expect(() => parseEnv({ ...required, MAP_S3_FORCE_PATH_STYLE: "sometimes" })).toThrow();
  });

  test("rejects a map storage endpoint that isn't an address", () => {
    expect(() => parseEnv({ ...required, MAP_S3_ENDPOINT: "account-id" })).toThrow();
    expect(() => parseEnv({ ...required, MAP_S3_ENDPOINT: "ftp://storage.example.com" })).toThrow();
  });

  test("rejects a map storage endpoint with the bucket in its path", () => {
    expect(() =>
      parseEnv({ ...required, MAP_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com/bucket" }),
    ).toThrow("put the bucket name in MAP_S3_BUCKET_NAME");
  });

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
});

describe("getServiceUrl", () => {
  test("talks to the service in the same container", () => {
    expect(getServiceUrl({})).toBe("http://127.0.0.1:8080");
    expect(getServiceUrl({ MAP_TILES_PORT: "9000" })).toBe("http://127.0.0.1:9000");
  });

  test("rejects a port that isn't a number", () => {
    expect(() => getServiceUrl({ MAP_TILES_PORT: "web" })).toThrow("MAP_TILES_PORT");
  });
});
