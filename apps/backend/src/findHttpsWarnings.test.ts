import { describe, expect, test } from "bun:test";
import { findHttpsWarnings } from "./findHttpsWarnings.ts";

const warnedNames = (BETTER_AUTH_URL: string, S3_CDN_URL = "https://cdn.openbeacon.net/file") =>
  findHttpsWarnings({ BETTER_AUTH_URL, S3_CDN_URL }).map((warning) => warning.split(" ")[0]);

describe("findHttpsWarnings", () => {
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
      expect(warnedNames(url, url)).toEqual([]);
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
    expect(warnedNames("http://api.example.com", "http://cdn.example.com/file")).toEqual([
      "BETTER_AUTH_URL",
      "S3_CDN_URL",
    ]);
    expect(warnedNames("https://api.example.com", "http://cdn.example.com/file")).toEqual([
      "S3_CDN_URL",
    ]);
  });

  test("explains the value and links to the docs", () => {
    expect(
      findHttpsWarnings({
        BETTER_AUTH_URL: "https://api.example.com",
        S3_CDN_URL: "http://cdn.example.com/file",
      }),
    ).toEqual([
      "S3_CDN_URL is http://cdn.example.com/file, which isn't HTTPS. The OpenBeacon app only connects over HTTPS, so profile and group pictures won't load. See https://docs.openbeacon.net/docs/self-host/networking-and-reverse-proxies#https-is-required",
    ]);
  });
});
