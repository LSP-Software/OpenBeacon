import { describe, expect, test } from "bun:test";
import { getAuthCapabilities } from "./capabilities.ts";

describe("getAuthCapabilities", () => {
  test("returns google support when both credentials exist", () => {
    expect(
      getAuthCapabilities({
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        emailEnabled: false,
      }),
    ).toEqual({ google: true, email: false });
  });

  test("returns no google support when client id is missing", () => {
    expect(
      getAuthCapabilities({
        GOOGLE_CLIENT_SECRET: "client-secret",
        emailEnabled: false,
      }),
    ).toEqual({ google: false, email: false });
  });

  test("returns no google support when client secret is missing", () => {
    expect(
      getAuthCapabilities({
        GOOGLE_CLIENT_ID: "client-id",
        emailEnabled: false,
      }),
    ).toEqual({ google: false, email: false });
  });

  test("returns email support when an email provider is configured", () => {
    expect(getAuthCapabilities({ emailEnabled: true })).toEqual({ google: false, email: true });
  });
});
