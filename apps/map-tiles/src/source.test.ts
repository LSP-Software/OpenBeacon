import { describe, expect, test } from "bun:test";
import { pickProtomapsBuild } from "./source.ts";

const builds = [
  { key: "20260315.pmtiles", size: 10, version: "4.14.3" },
  { key: "20261107.pmtiles", size: 30, version: "4.15.2" },
  { key: "20261106.pmtiles", size: 20, version: "4.15.2" },
  { key: "20231009.pmtiles", size: 5, version: "3.0.0" },
];

describe("pickProtomapsBuild", () => {
  test("picks the newest build with a supported schema", () => {
    expect(pickProtomapsBuild({ builds, date: undefined }).key).toBe("20261107.pmtiles");
  });

  test("skips newer builds with an unsupported schema", () => {
    expect(
      pickProtomapsBuild({
        builds: [...builds, { key: "20261201.pmtiles", size: 40, version: "5.0.0" }],
        date: undefined,
      }).key,
    ).toBe("20261107.pmtiles");
  });

  test("picks a requested date", () => {
    expect(pickProtomapsBuild({ builds, date: "20260315" }).size).toBe(10);
  });

  test("rejects a requested date that is missing or unsupported", () => {
    expect(() => pickProtomapsBuild({ builds, date: "20200101" })).toThrow("no longer lists");
    expect(() => pickProtomapsBuild({ builds, date: "20231009" })).toThrow("unsupported");
  });
});
