import { describe, expect, test } from "bun:test";
import { speedLimitPackManifestSchema } from "@openbeacon/map-tiles";
import { buildBoundaries, buildManifest, findUnusedKeys } from "./publish.ts";

const sha = (letter: string) => letter.repeat(64);

const entry = (id: string, letter: string) => ({
  id,
  name: id,
  countryCode: "GB",
  file: `${id}.obsl`,
  size: 1000,
  sha256: sha(letter),
  bounds: [-8.6, 49.9, 1.8, 60.9],
});

describe("buildManifest", () => {
  test("lists every continent's packs at content-addressed paths with the ODbL attribution", () => {
    const manifest = buildManifest({
      boundaries: { path: "boundaries-cccccccccccccccc.json", size: 50, sha256: sha("c") },
      build: "20270101",
      continents: [
        { continent: "europe", build: 20270101, regions: [entry("united-kingdom", "a")] },
        { continent: "north-america", build: 20270101, regions: [entry("us/alabama", "b")] },
      ],
      publishedAt: "2027-01-02T03:00:00.000Z",
    });

    expect(speedLimitPackManifestSchema.parse(manifest)).toEqual(manifest);
    expect(manifest.regions.map(({ id, path }) => [id, path])).toEqual([
      ["united-kingdom", "packs/united-kingdom-aaaaaaaaaaaaaaaa.obsl"],
      ["us/alabama", "packs/us/alabama-bbbbbbbbbbbbbbbb.obsl"],
    ]);
    expect(manifest.license).toBe("ODbL-1.0");
    expect(manifest.attribution).toContain("© OpenStreetMap contributors");
  });

  test("refuses continents built for another month", () => {
    expect(() =>
      buildManifest({
        boundaries: { path: "boundaries.json", size: 50, sha256: sha("c") },
        build: "20270101",
        continents: [
          { continent: "europe", build: 20261201, regions: [entry("united-kingdom", "a")] },
        ],
        publishedAt: "2027-01-02T03:00:00.000Z",
      }),
    ).toThrow("20261201");
  });

  test("refuses a region built twice", () => {
    expect(() =>
      buildManifest({
        boundaries: { path: "boundaries.json", size: 50, sha256: sha("c") },
        build: "20270101",
        continents: [
          { continent: "europe", build: 20270101, regions: [entry("united-kingdom", "a")] },
          { continent: "europe", build: 20270101, regions: [entry("united-kingdom", "b")] },
        ],
        publishedAt: "2027-01-02T03:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("buildBoundaries", () => {
  const index = {
    features: [
      {
        properties: { id: "united-kingdom" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [-8.123456, 49.987654],
                [1.8, 49.9],
                [1.8, 60.9],
                [-8.123456, 49.987654],
              ],
            ],
          ],
        },
      },
      { properties: { id: "france" }, geometry: { type: "Polygon", coordinates: [] } },
    ],
  };

  test("keeps each packed region's outline, rounded to about 10 m", () => {
    expect(buildBoundaries({ index, regionIds: ["united-kingdom"] })).toEqual({
      format: 1,
      regions: [
        {
          id: "united-kingdom",
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [-8.1235, 49.9877],
                  [1.8, 49.9],
                  [1.8, 60.9],
                  [-8.1235, 49.9877],
                ],
              ],
            ],
          },
        },
      ],
    });
  });

  test("fails when Geofabrik has no outline for a region", () => {
    expect(() => buildBoundaries({ index, regionIds: ["germany"] })).toThrow("germany");
  });
});

describe("findUnusedKeys", () => {
  test("deletes only files neither the new nor the replaced manifest uses", () => {
    expect(
      findUnusedKeys({
        keys: [
          "speed-limits/manifest.json",
          "speed-limits/boundaries-new.json",
          "speed-limits/boundaries-old.json",
          "speed-limits/boundaries-older.json",
          "speed-limits/packs/uk-new.obsl",
          "speed-limits/packs/uk-old.obsl",
          "speed-limits/packs/uk-failed-run.obsl",
        ],
        manifests: [
          { boundaries: { path: "boundaries-new.json" }, regions: [{ path: "packs/uk-new.obsl" }] },
          { boundaries: { path: "boundaries-old.json" }, regions: [{ path: "packs/uk-old.obsl" }] },
        ],
      }),
    ).toEqual(["speed-limits/boundaries-older.json", "speed-limits/packs/uk-failed-run.obsl"]);
  });
});
