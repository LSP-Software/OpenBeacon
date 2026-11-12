import { describe, expect, test } from "bun:test";
import { formatMapVersion, getPmtilesSource, hasPmtilesArchiveChanged } from "./pmtilesUrl.ts";

describe("hasPmtilesArchiveChanged", () => {
  test("does not remount for the first archive or a refreshed url for the same archive", () => {
    expect(hasPmtilesArchiveChanged({ appliedArchiveId: null, archiveId: "a" })).toBe(false);
    expect(hasPmtilesArchiveChanged({ appliedArchiveId: "a", archiveId: "a" })).toBe(false);
  });

  test("remounts when the server moves the map to another archive", () => {
    expect(hasPmtilesArchiveChanged({ appliedArchiveId: "a", archiveId: "b" })).toBe(true);
  });

  test("does not remount when a backend does not report archives", () => {
    expect(hasPmtilesArchiveChanged({ appliedArchiveId: "a", archiveId: null })).toBe(false);
  });
});

describe("getPmtilesSource", () => {
  const signedUrl = "https://tiles.example.com/map/planet-b.pmtiles?X-Amz-Signature=abc";

  test("gives each build in a slot its own source url so cached tiles never mix", () => {
    const older = getPmtilesSource({ archiveId: "b-20261001", signedUrl });
    const newer = getPmtilesSource({ archiveId: "b-20261201", signedUrl });

    expect(older.sourceUrl).toBe(
      "https://tiles.example.com/map/planet-b.pmtiles?archive=b-20261001",
    );
    expect(newer.sourceUrl).not.toBe(older.sourceUrl);
    expect(new RegExp(older.find).test(older.sourceUrl)).toBe(true);
    expect(new RegExp(older.find).test(newer.sourceUrl)).toBe(false);
  });

  test("keeps the plain url for backends without archives", () => {
    const { find, sourceUrl } = getPmtilesSource({ archiveId: null, signedUrl });

    expect(sourceUrl).toBe("https://tiles.example.com/map/planet-b.pmtiles");
    expect(new RegExp(find).test(`${sourceUrl}?anything=1`)).toBe(true);
  });
});

describe("formatMapVersion", () => {
  test("shows the build date, or the archive when the backend has no manifest", () => {
    expect(formatMapVersion({ archiveId: "b-20261101", mapBuild: "20261101" })).toBe("2026-11-01");
    expect(formatMapVersion({ archiveId: "planet.pmtiles", mapBuild: null })).toBe(
      "planet.pmtiles",
    );
  });
});
