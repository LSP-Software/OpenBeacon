import { describe, expect, mock, test } from "bun:test";
import type { MirroredSpeedLimitPacks } from "@openbeacon/map-tiles";
import { createSpeedLimitPackUrls } from "./speedLimitPackUrls.ts";

const sha = (letter: string) => letter.repeat(64);

const mirrored = (mirroredAt: string, ids: string[]): MirroredSpeedLimitPacks => ({
  format: 1,
  build: "20270101",
  publishedAt: "2027-01-02T03:00:00.000Z",
  mirroredAt,
  license: "ODbL-1.0",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution: "© OpenStreetMap contributors",
  boundaries: { key: "speed-limits/boundaries-1.json", size: 10, sha256: sha("b") },
  regions: ids.map((id, index) => ({
    id,
    name: id,
    countryCode: "GB",
    bounds: [-8, 49, 2, 61],
    key: `speed-limits/${id}-1.obsl`,
    size: 100 + index,
    sha256: sha("a"),
  })),
  retired: [{ key: "speed-limits/old-1.obsl", retiredAt: mirroredAt }],
});

const sign = mock(async (key: string) => `https://storage.example.org/${key}?signed`);

describe("createSpeedLimitPackUrls", () => {
  test("signs every mirrored region, never just one", async () => {
    const urls = createSpeedLimitPackUrls({
      now: () => Date.parse("2027-01-03T00:00:00Z"),
      readManifest: async () =>
        mirrored("2027-01-02T04:00:00.000Z", ["united-kingdom", "ireland", "us/alabama"]),
      sign,
    });

    const result = await urls();

    expect(result?.regions.map(({ id, url }) => [id, url])).toEqual([
      ["united-kingdom", "https://storage.example.org/speed-limits/united-kingdom-1.obsl?signed"],
      ["ireland", "https://storage.example.org/speed-limits/ireland-1.obsl?signed"],
      ["us/alabama", "https://storage.example.org/speed-limits/us/alabama-1.obsl?signed"],
    ]);
    expect(result?.regions[2]).toMatchObject({
      size: 102,
      sha256: sha("a"),
      bounds: [-8, 49, 2, 61],
    });
    expect(result?.boundaries).toEqual({
      url: "https://storage.example.org/speed-limits/boundaries-1.json?signed",
      size: 10,
      sha256: sha("b"),
    });
    expect(result?.attribution).toBe("© OpenStreetMap contributors");
    expect(result?.expiresAt).toBe("2027-01-03T01:00:00.000Z");
    expect(JSON.stringify(result)).not.toContain("old-1");
  });

  test("returns nothing until the server has mirrored any packs", async () => {
    const urls = createSpeedLimitPackUrls({ readManifest: async () => null, sign });

    expect(await urls()).toBeNull();
  });

  test("reuses the signed list for everyone until it nears expiry or the mirror changes", async () => {
    let now = Date.parse("2027-01-03T00:00:00Z");
    let manifest = mirrored("2027-01-02T04:00:00.000Z", ["united-kingdom"]);
    const countingSign = mock(async (key: string) => `${key}?at=${now}`);
    const urls = createSpeedLimitPackUrls({
      now: () => now,
      readManifest: async () => manifest,
      sign: countingSign,
    });

    const first = await urls();
    now += 29 * 60 * 1000;
    expect(await urls()).toBe(first);
    expect(countingSign).toHaveBeenCalledTimes(2);

    now += 2 * 60 * 1000;
    expect((await urls())?.expiresAt).toBe("2027-01-03T01:31:00.000Z");

    manifest = mirrored("2027-02-02T04:00:00.000Z", ["united-kingdom"]);
    expect((await urls())?.build).toBe("20270101");
    expect(countingSign).toHaveBeenCalledTimes(6);
  });
});
