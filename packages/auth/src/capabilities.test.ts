import { describe, expect, test } from "bun:test";
import { getAuthCapabilities } from "./capabilities.ts";

describe("getAuthCapabilities", () => {
  test("returns google support when both credentials exist", () => {
    expect(
      getAuthCapabilities({
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
      }),
    ).toEqual({ google: true });
  });

  test("returns no google support when client id is missing", () => {
    expect(
      getAuthCapabilities({
        GOOGLE_CLIENT_SECRET: "client-secret",
      }),
    ).toEqual({ google: false });
  });

  test("returns no google support when client secret is missing", () => {
    expect(
      getAuthCapabilities({
        GOOGLE_CLIENT_ID: "client-id",
      }),
    ).toEqual({ google: false });
  });
});
