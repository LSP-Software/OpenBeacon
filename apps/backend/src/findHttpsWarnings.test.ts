import { describe, expect, test } from "bun:test";
import { findHttpsWarnings } from "./findHttpsWarnings.ts";

const warnedNames = (
  BETTER_AUTH_URL: string,
  storage: {
    IMAGES_S3_ENDPOINT?: string;
    IMAGES_S3_PUBLIC_ENDPOINT?: string;
    IMAGES_S3_CDN_URL?: string;
    MAP_S3_ENDPOINT?: string;
    MAP_S3_PUBLIC_ENDPOINT?: string;
  } = {},
) =>
  findHttpsWarnings({
    BETTER_AUTH_URL,
    IMAGES_S3_ENDPOINT: "https://images-storage.example.com",
    IMAGES_S3_CDN_URL: "https://cdn.openbeacon.net/file",
    MAP_S3_ENDPOINT: "https://map-storage.example.com",
    ...storage,
  }).map((warning) => warning.split(" ")[0]);

describe("findHttpsWarnings", () => {
  test("checks the public storage addresses phones use instead of internal ones", () => {
    expect(
      warnedNames("https://api.example.com", {
        IMAGES_S3_ENDPOINT: "http://storage:7070",
        IMAGES_S3_PUBLIC_ENDPOINT: "https://beacon.example.com",
        MAP_S3_ENDPOINT: "http://storage:7070",
        MAP_S3_PUBLIC_ENDPOINT: "https://beacon.example.com",
      }),
    ).toEqual([]);
    expect(
      warnedNames("https://api.example.com", {
        IMAGES_S3_ENDPOINT: "https://images-storage.example.com",
        IMAGES_S3_PUBLIC_ENDPOINT: "http://storage.example.com",
        MAP_S3_ENDPOINT: "https://map-storage.example.com",
        MAP_S3_PUBLIC_ENDPOINT: "http://storage.example.com",
      }),
    ).toEqual(["IMAGES_S3_PUBLIC_ENDPOINT", "MAP_S3_PUBLIC_ENDPOINT"]);
  });

  test("does not warn for https", () => {
    expect(warnedNames("https://api.example.com")).toEqual([]);
    expect(warnedNames("https://192.168.1.20:3000")).toEqual([]);
  });

  test("does not warn for local development addresses over http", () => {
    for (const url of [
      "http://localhost:3000",
      "http://api.localhost",
      "http://127.0.0.1:3000",
      "http://127.5.6.7",
      "http://[::1]:3000",
      "http://10.0.2.2:3000",
    ]) {
      expect(
        warnedNames(url, {
          IMAGES_S3_ENDPOINT: url,
          IMAGES_S3_CDN_URL: url,
          MAP_S3_ENDPOINT: url,
        }),
      ).toEqual([]);
    }
  });

  test("warns for http on public hosts and LAN addresses", () => {
    for (const url of [
      "http://api.example.com",
      "http://192.168.1.20:3000",
      "http://10.0.0.5",
      "http://172.16.0.1",
      "http://openbeacon.local",
      "http://localhost.example.com",
      "http://127.0.0.1.example.com",
    ]) {
      expect(warnedNames(url)).toEqual(["BETTER_AUTH_URL"]);
    }
  });

  test("warns for each value that is not https", () => {
    expect(
      warnedNames("http://api.example.com", { IMAGES_S3_CDN_URL: "http://cdn.example.com/file" }),
    ).toEqual(["BETTER_AUTH_URL", "IMAGES_S3_CDN_URL"]);
    expect(
      warnedNames("https://api.example.com", { IMAGES_S3_CDN_URL: "http://cdn.example.com/file" }),
    ).toEqual(["IMAGES_S3_CDN_URL"]);
    expect(
      warnedNames("https://api.example.com", { MAP_S3_ENDPOINT: "http://map-storage.example.com" }),
    ).toEqual(["MAP_S3_ENDPOINT"]);
    expect(
      warnedNames("https://api.example.com", {
        IMAGES_S3_ENDPOINT: "http://images-storage.example.com",
      }),
    ).toEqual(["IMAGES_S3_ENDPOINT"]);
  });

  test("explains the value and links to the docs", () => {
    expect(
      findHttpsWarnings({
        BETTER_AUTH_URL: "https://api.example.com",
        IMAGES_S3_ENDPOINT: "http://images-storage.example.com",
        IMAGES_S3_CDN_URL: "http://cdn.example.com/file",
        MAP_S3_ENDPOINT: "https://map-storage.example.com",
      }),
    ).toEqual([
      "IMAGES_S3_ENDPOINT is http://images-storage.example.com, which isn't HTTPS. The OpenBeacon app only connects over HTTPS, so profile and group pictures can't be uploaded. See https://docs.openbeacon.net/docs/self-host/networking-and-reverse-proxies#https-is-required",
      "IMAGES_S3_CDN_URL is http://cdn.example.com/file, which isn't HTTPS. The OpenBeacon app only connects over HTTPS, so profile and group pictures won't load. See https://docs.openbeacon.net/docs/self-host/networking-and-reverse-proxies#https-is-required",
    ]);
  });
});
