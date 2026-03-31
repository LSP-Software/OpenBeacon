import { describe, expect, test } from "bun:test";
import { resolveClientIp } from "./clientIp.ts";

const createHeaders = (input: Record<string, string>) => {
  return new Headers(input);
};

describe("resolveClientIp", () => {
  test("ignores proxy headers when trusted proxy provider is none", () => {
    expect(
      resolveClientIp({
        headers: createHeaders({
          "cf-connecting-ip": "198.51.100.1",
          "x-forwarded-for": "198.51.100.2, 198.51.100.3",
          "x-real-ip": "198.51.100.4",
        }),
        requestIp: "203.0.113.10",
        trustedProxyProvider: "none",
      }),
    ).toBe("203.0.113.10");
  });

  test("prefers cloudflare headers before other proxy headers", () => {
    expect(
      resolveClientIp({
        headers: createHeaders({
          "cf-connecting-ip": "198.51.100.1",
          "x-forwarded-for": "198.51.100.2, 198.51.100.3",
          "x-real-ip": "198.51.100.4",
        }),
        requestIp: "203.0.113.10",
        trustedProxyProvider: "cloudflare",
      }),
    ).toBe("198.51.100.1");
  });

  test("uses the first x-forwarded-for hop for trusted proxies", () => {
    expect(
      resolveClientIp({
        headers: createHeaders({
          "x-forwarded-for": "198.51.100.2, 198.51.100.3",
          "x-real-ip": "198.51.100.4",
        }),
        requestIp: "203.0.113.10",
        trustedProxyProvider: "trusted-proxy",
      }),
    ).toBe("198.51.100.2");
  });

  test("falls back to requestIp or null when trusted headers are missing", () => {
    expect(
      resolveClientIp({
        headers: createHeaders({}),
        requestIp: "203.0.113.10",
        trustedProxyProvider: "cloudflare",
      }),
    ).toBe("203.0.113.10");

    expect(
      resolveClientIp({
        headers: createHeaders({}),
        requestIp: null,
        trustedProxyProvider: "trusted-proxy",
      }),
    ).toBeNull();
  });
});
