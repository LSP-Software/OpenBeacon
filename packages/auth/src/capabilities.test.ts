import { describe, expect, test } from "bun:test";
import { getAuthCapabilities } from "./capabilities.ts";

describe("getAuthCapabilities", () => {
  test("returns google support and the client ID phones need to match when both credentials exist", () => {
    expect(
      getAuthCapabilities({
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        emailEnabled: false,
      }),
    ).toEqual({ google: true, googleClientId: "client-id", email: false });
  });

  test("returns no google support when client id is missing", () => {
    expect(
      getAuthCapabilities({
        GOOGLE_CLIENT_SECRET: "client-secret",
        emailEnabled: false,
      }),
    ).toEqual({ google: false, googleClientId: null, email: false });
  });

  test("returns no google support when client secret is missing", () => {
    expect(
      getAuthCapabilities({
        GOOGLE_CLIENT_ID: "client-id",
        emailEnabled: false,
      }),
    ).toEqual({ google: false, googleClientId: null, email: false });
  });

  test("returns email support when an email provider is configured", () => {
    expect(getAuthCapabilities({ emailEnabled: true })).toEqual({
      google: false,
      googleClientId: null,
      email: true,
    });
  });
});
