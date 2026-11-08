import { describe, expect, test } from "bun:test";
import { authenticateCloudflare, resolveClientIp } from "./clientIp.ts";

const createHeaders = (input: Record<string, string>) => {
  return new Headers(input);
};

describe("authenticateCloudflare", () => {
  const secret = "a-secure-test-secret-with-32-characters";

  test("accepts only the shared secret with a valid client IP", () => {
    expect(
      authenticateCloudflare({
        secret,
        headers: createHeaders({
          "x-openbeacon-origin-secret": secret,
          "cf-connecting-ip": "2001:db8::1",
        }),
      }),
    ).toBe(true);

    for (const headers of [
      { "x-openbeacon-origin-secret": "wrong", "cf-connecting-ip": "198.51.100.1" },
      { "x-openbeacon-origin-secret": secret, "cf-connecting-ip": "not-an-ip" },
      { "x-openbeacon-origin-secret": secret },
      { "cf-connecting-ip": "198.51.100.1" },
    ]) {
      expect(authenticateCloudflare({ secret, headers: createHeaders(headers) })).toBe(false);
    }
  });
});

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

  test("uses the proxy-appended last x-forwarded-for hop so clients cannot spoof it", () => {
    expect(
      resolveClientIp({
        headers: createHeaders({
          "x-forwarded-for": "198.51.100.2, 198.51.100.3",
          "x-real-ip": "198.51.100.4",
        }),
        requestIp: "203.0.113.10",
        trustedProxyProvider: "trusted-proxy",
      }),
    ).toBe("198.51.100.3");

    expect(
      resolveClientIp({
        headers: createHeaders({ "x-forwarded-for": "198.51.100.3" }),
        requestIp: "203.0.113.10",
        trustedProxyProvider: "trusted-proxy",
      }),
    ).toBe("198.51.100.3");
  });

  test("trusted-proxy ignores an empty last x-forwarded-for hop", () => {
    expect(
      resolveClientIp({
        headers: createHeaders({
          "x-forwarded-for": "198.51.100.2, ",
          "x-real-ip": "198.51.100.4",
        }),
        requestIp: "203.0.113.10",
        trustedProxyProvider: "trusted-proxy",
      }),
    ).toBe("198.51.100.4");
  });

  test("cloudflare ignores spoofable forwarding headers when cf-connecting-ip is absent", () => {
    expect(
      resolveClientIp({
        headers: createHeaders({
          "x-forwarded-for": "198.51.100.2, 198.51.100.3",
          "x-real-ip": "198.51.100.4",
        }),
        requestIp: "203.0.113.10",
        trustedProxyProvider: "cloudflare",
      }),
    ).toBe("203.0.113.10");
  });

  test("trusted-proxy falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(
      resolveClientIp({
        headers: createHeaders({
          "x-real-ip": "198.51.100.4",
        }),
        requestIp: "203.0.113.10",
        trustedProxyProvider: "trusted-proxy",
      }),
    ).toBe("198.51.100.4");
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
