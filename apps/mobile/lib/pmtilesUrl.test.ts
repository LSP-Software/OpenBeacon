import { describe, expect, test } from "bun:test";
import {
  describeMapVersion,
  getPmtilesSource,
  hasPmtilesArchiveChanged,
  shouldRetrySignedPmtilesUrl,
} from "./pmtilesUrl.ts";

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

describe("describeMapVersion", () => {
  test("shows the slot in use and the Protomaps build date", () => {
    expect(
      describeMapVersion({ archiveId: "b-20261101", mapBuild: "20261101", mapSlot: "b" }),
    ).toEqual({ date: "2026-11-01", slot: "B", summary: "Map B, 2026-11-01" });
  });

  test("falls back to the archive when the backend has no manifest", () => {
    expect(
      describeMapVersion({ archiveId: "planet.pmtiles", mapBuild: null, mapSlot: null }),
    ).toEqual({ date: null, slot: null, summary: "planet.pmtiles" });
  });
});

describe("shouldRetrySignedPmtilesUrl", () => {
  test("gives up on an unreachable server so the map can offer a retry", () => {
    expect(shouldRetrySignedPmtilesUrl(3, undefined)).toBe(true);
    expect(shouldRetrySignedPmtilesUrl(4, undefined)).toBe(false);
    expect(shouldRetrySignedPmtilesUrl(4, "INTERNAL_SERVER_ERROR")).toBe(false);
  });
  test("keeps waiting while the server prepares the map and never retries a signed-out session", () => {
    expect(shouldRetrySignedPmtilesUrl(50, "SERVICE_UNAVAILABLE")).toBe(true);
    expect(shouldRetrySignedPmtilesUrl(0, "UNAUTHORIZED")).toBe(false);
  });
});
