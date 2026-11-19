import { describe, expect, test } from "bun:test";
import { googleSignInNonce } from "./googleSignInNonce.ts";

describe("googleSignInNonce", () => {
  test("is the same for any address on the same server", () => {
    const nonce = googleSignInNonce({ serverUrl: "https://api.openbeacon.net", challenge: "abc" });
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    for (const serverUrl of [
      "https://API.openbeacon.net/",
      "https://api.openbeacon.net:443/api/auth",
      "https://api.openbeacon.net/some/path?query=1",
    ]) {
      expect(googleSignInNonce({ serverUrl, challenge: "abc" })).toBe(nonce);
    }
  });

  test("differs for another server or another challenge", () => {
    const nonce = googleSignInNonce({ serverUrl: "https://api.openbeacon.net", challenge: "abc" });
    for (const serverUrl of [
      "https://beacon.example.com",
      "http://api.openbeacon.net",
      "https://api.openbeacon.net:8443",
      "https://api.openbeacon.net.example.com",
    ]) {
      expect(googleSignInNonce({ serverUrl, challenge: "abc" })).not.toBe(nonce);
    }
    expect(
      googleSignInNonce({ serverUrl: "https://api.openbeacon.net", challenge: "abd" }),
    ).not.toBe(nonce);
  });

  test("keeps its format so phones and servers on different versions agree", () => {
    expect(
      googleSignInNonce({ serverUrl: "https://api.openbeacon.net", challenge: "challenge" }),
    ).toBe("d4acd0b719df768bbd413c6ee2082e5f8c60d2ea016cbaebea2b0812722f2014");
  });
});
