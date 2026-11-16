import { describe, expect, test } from "bun:test";
import { parseClientPointId } from "./groupTracking.ts";

describe("parseClientPointId", () => {
  test("splits the sharing revision prefix from the 8-byte point ID", () => {
    expect(parseClientPointId("s3.14:AAAAAAAAAAE=")).toEqual({
      pointId: 1n,
      revisionPrefix: "s3.14:",
    });
    expect(parseClientPointId("AQIDBAUGBwg=")).toEqual({
      pointId: 0x0102030405060708n,
      revisionPrefix: "",
    });
  });

  test("reads IDs with the top bit set as negative bigints so every 8-byte ID fits a bigint column", () => {
    expect(parseClientPointId("//////////8=").pointId).toBe(-1n);
    expect(parseClientPointId("gAAAAAAAAAA=").pointId).toBe(-(2n ** 63n));
  });
});
