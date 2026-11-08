import { describe, expect, test } from "bun:test";
import {
  ARCHIVE_DELETE_MARGIN_MS,
  ARCHIVE_GRACE_PERIOD_MS,
  getPrunableArchives,
  type MapTilesArchive,
  type MapTilesManifest,
  mapTilesManifestSchema,
  publishArchive,
  removeArchives,
  resolveArchiveKey,
  rollbackArchive,
} from "./manifest.ts";

const publishedAt = Date.parse("2026-11-01T00:00:00.000Z");

const archive = (key: string): MapTilesArchive => ({
  key,
  publishedAt: new Date(publishedAt).toISOString(),
  schemaVersion: "4.15.2",
  size: 1000,
});

const manifestWithPrevious = (servedUntil: number): MapTilesManifest => ({
  current: archive("planet-new.pmtiles"),
  previous: [
    { ...archive("planet-old.pmtiles"), servedUntil: new Date(servedUntil).toISOString() },
  ],
});

describe("resolveArchiveKey", () => {
  const servedUntil = publishedAt + ARCHIVE_GRACE_PERIOD_MS;
  const manifest = manifestWithPrevious(servedUntil);

  test("serves the current archive when no archive is requested", () => {
    expect(resolveArchiveKey({ manifest, now: publishedAt, requestedKey: undefined })).toBe(
      "planet-new.pmtiles",
    );
  });

  test("keeps serving a previous archive until it stops being served", () => {
    expect(
      resolveArchiveKey({ manifest, now: servedUntil - 1, requestedKey: "planet-old.pmtiles" }),
    ).toBe("planet-old.pmtiles");
  });

  test("moves clients to the current archive once a previous archive stops being served", () => {
    expect(
      resolveArchiveKey({ manifest, now: servedUntil, requestedKey: "planet-old.pmtiles" }),
    ).toBe("planet-new.pmtiles");
  });

  test("serves the current archive for unknown requested keys", () => {
    expect(resolveArchiveKey({ manifest, now: publishedAt, requestedKey: "../other-object" })).toBe(
      "planet-new.pmtiles",
    );
  });
});

describe("publishArchive", () => {
  test("creates a manifest when there is none", () => {
    expect(publishArchive({ archive: archive("a"), manifest: null, now: publishedAt })).toEqual({
      current: archive("a"),
      previous: [],
    });
  });

  test("serves the replaced archive for the grace period", () => {
    const next = publishArchive({
      archive: archive("b"),
      manifest: { current: archive("a"), previous: [] },
      now: publishedAt,
    });

    expect(next.current).toEqual(archive("b"));
    expect(next.previous).toEqual([
      {
        ...archive("a"),
        servedUntil: new Date(publishedAt + ARCHIVE_GRACE_PERIOD_MS).toISOString(),
      },
    ]);
    expect(ARCHIVE_GRACE_PERIOD_MS).toBe(8 * 24 * 60 * 60 * 1000);
  });

  test("removes a republished archive from the previous list", () => {
    const next = publishArchive({
      archive: archive("planet-old.pmtiles"),
      manifest: manifestWithPrevious(publishedAt),
      now: publishedAt,
    });

    expect(next.current.key).toBe("planet-old.pmtiles");
    expect(next.previous.map((previous) => previous.key)).toEqual(["planet-new.pmtiles"]);
  });

  test("refuses to republish the current archive", () => {
    expect(() =>
      publishArchive({
        archive: archive("a"),
        manifest: { current: archive("a"), previous: [] },
        now: publishedAt,
      }),
    ).toThrow("already the current archive");
  });
});

describe("rollbackArchive", () => {
  test("restores the latest previous archive and stops serving the rolled back archive", () => {
    const now = publishedAt + 1000;
    const next = rollbackArchive({ manifest: manifestWithPrevious(publishedAt), now });

    expect(next.current).toEqual(archive("planet-old.pmtiles"));
    expect(next.previous).toEqual([
      { ...archive("planet-new.pmtiles"), servedUntil: new Date(now).toISOString() },
    ]);
    expect(resolveArchiveKey({ manifest: next, now, requestedKey: "planet-new.pmtiles" })).toBe(
      "planet-old.pmtiles",
    );
  });

  test("fails when there is nothing to roll back to", () => {
    expect(() =>
      rollbackArchive({ manifest: { current: archive("a"), previous: [] }, now: publishedAt }),
    ).toThrow("no previous archive");
  });
});

describe("getPrunableArchives", () => {
  test("only prunes archives after they stop being served plus the delete margin", () => {
    const servedUntil = publishedAt + ARCHIVE_GRACE_PERIOD_MS;
    const manifest = manifestWithPrevious(servedUntil);

    expect(
      getPrunableArchives({ manifest, now: servedUntil + ARCHIVE_DELETE_MARGIN_MS - 1 }),
    ).toEqual([]);
    expect(
      getPrunableArchives({ manifest, now: servedUntil + ARCHIVE_DELETE_MARGIN_MS }).map(
        (previous) => previous.key,
      ),
    ).toEqual(["planet-old.pmtiles"]);
  });

  test("never prunes the current archive", () => {
    const manifest: MapTilesManifest = {
      current: archive("a"),
      previous: [{ ...archive("a"), servedUntil: new Date(0).toISOString() }],
    };

    expect(getPrunableArchives({ manifest, now: publishedAt })).toEqual([]);
  });

  test("removeArchives drops pruned archives and keeps the current archive", () => {
    const manifest = manifestWithPrevious(publishedAt);

    expect(removeArchives({ keys: ["planet-old.pmtiles"], manifest })).toEqual({
      current: manifest.current,
      previous: [],
    });
  });
});

describe("mapTilesManifestSchema", () => {
  test("rejects manifests with unknown fields", () => {
    expect(
      mapTilesManifestSchema.safeParse({ current: archive("a"), previous: [], extra: true })
        .success,
    ).toBe(false);
  });
});
