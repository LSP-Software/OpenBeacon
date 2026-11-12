import { describe, expect, test } from "bun:test";
import {
  ARCHIVE_GRACE_PERIOD_MS,
  clearStandbySlot,
  getStandbyReuseAt,
  type MapTilesArchive,
  type MapTilesManifest,
  mapTilesManifestSchema,
  publishToStandby,
  resolveArchive,
  rollbackToStandby,
  SLOT_REUSE_MARGIN_MS,
} from "./manifest.ts";

const now = Date.parse("2026-11-01T00:00:00.000Z");

const archive = (key: string, build: string): MapTilesArchive => ({
  build,
  key,
  publishedAt: new Date(now).toISOString(),
  schemaVersion: "4.15.2",
  size: 1000,
});

const swapped = (servedUntil: number): MapTilesManifest => ({
  current: "b",
  slots: {
    a: {
      ...archive("planet-a.pmtiles", "20261001"),
      servedUntil: new Date(servedUntil).toISOString(),
    },
    b: archive("planet-b.pmtiles", "20261101"),
  },
});

describe("resolveArchive", () => {
  const servedUntil = now + ARCHIVE_GRACE_PERIOD_MS;
  const manifest = swapped(servedUntil);

  test("serves the current slot when no archive is requested", () => {
    expect(resolveArchive({ manifest, now, requestedId: undefined })).toEqual({
      archive: manifest.slots.b as MapTilesArchive,
      id: "b-20261101",
      slot: "b",
    });
  });

  test("keeps a client on the replaced slot until its grace period ends", () => {
    expect(resolveArchive({ manifest, now: servedUntil - 1, requestedId: "a-20261001" }).id).toBe(
      "a-20261001",
    );
    expect(resolveArchive({ manifest, now: servedUntil, requestedId: "a-20261001" }).id).toBe(
      "b-20261101",
    );
  });

  test("moves a client to the current slot when its build was overwritten", () => {
    expect(resolveArchive({ manifest, now, requestedId: "a-20260901" }).id).toBe("b-20261101");
  });

  test("serves the current slot for unknown ids", () => {
    expect(resolveArchive({ manifest, now, requestedId: "../other-object" }).id).toBe("b-20261101");
  });
});

describe("tick tock publishing", () => {
  test("the first publish fills slot a", () => {
    const first = publishToStandby({
      archive: archive("planet-a.pmtiles", "20261001"),
      manifest: null,
      now,
    });

    expect(first).toEqual({
      current: "a",
      slots: { a: archive("planet-a.pmtiles", "20261001"), b: null },
    });
  });

  test("publishes into the standby slot and keeps the replaced slot for rollback", () => {
    const manifest: MapTilesManifest = {
      current: "a",
      slots: { a: archive("planet-a.pmtiles", "20261001"), b: null },
    };
    const next = publishToStandby({
      archive: archive("planet-b.pmtiles", "20261101"),
      manifest,
      now,
    });

    expect(next.current).toBe("b");
    expect(next.slots.b?.build).toBe("20261101");
    expect(next.slots.a?.servedUntil).toBe(new Date(now + ARCHIVE_GRACE_PERIOD_MS).toISOString());
  });

  test("never overwrites a standby slot clients may still be using", () => {
    const servedUntil = now + ARCHIVE_GRACE_PERIOD_MS;
    const manifest = swapped(servedUntil);

    expect(getStandbyReuseAt(manifest)).toBe(servedUntil + SLOT_REUSE_MARGIN_MS);
    expect(() => clearStandbySlot({ manifest, now: servedUntil })).toThrow(/still be in use/);
    expect(
      clearStandbySlot({ manifest, now: servedUntil + SLOT_REUSE_MARGIN_MS }).slots.a,
    ).toBeNull();
  });

  test("refuses to publish over a standby slot that was not cleared", () => {
    expect(() =>
      publishToStandby({
        archive: archive("planet-a.pmtiles", "20261201"),
        manifest: swapped(now),
        now,
      }),
    ).toThrow(/must be cleared/);
  });

  test("alternates between the two slots", () => {
    let manifest = publishToStandby({
      archive: archive("planet-a.pmtiles", "20261001"),
      manifest: null,
      now,
    });
    const slots: string[] = [manifest.current];

    for (const [index, build] of ["20261101", "20261201", "20270101"].entries()) {
      const at = now + (index + 1) * 30 * 24 * 60 * 60 * 1000;
      manifest = clearStandbySlot({ manifest, now: at });
      manifest = publishToStandby({
        archive: archive(`planet-${manifest.current === "a" ? "b" : "a"}.pmtiles`, build),
        manifest,
        now: at,
      });
      slots.push(manifest.current);
    }

    expect(slots).toEqual(["a", "b", "a", "b"]);
    expect(Object.values(manifest.slots).filter(Boolean)).toHaveLength(2);
  });
});

describe("rollbackToStandby", () => {
  test("restores the standby slot and moves clients off the bad one at once", () => {
    const manifest = swapped(now + ARCHIVE_GRACE_PERIOD_MS);
    const next = rollbackToStandby({ manifest, now });

    expect(next.current).toBe("a");
    expect(next.slots.a?.servedUntil).toBeUndefined();
    expect(next.slots.b?.servedUntil).toBe(new Date(now).toISOString());
    expect(resolveArchive({ manifest: next, now, requestedId: "b-20261101" }).id).toBe(
      "a-20261001",
    );
  });

  test("fails without a standby map", () => {
    expect(() =>
      rollbackToStandby({
        manifest: { current: "a", slots: { a: archive("planet-a.pmtiles", "20261001"), b: null } },
        now,
      }),
    ).toThrow(/no previous map/);
  });
});

describe("mapTilesManifestSchema", () => {
  test("keeps unknown fields so older readers neither fail nor drop them", () => {
    const parsed = mapTilesManifestSchema.parse({ ...swapped(now), note: "kept" });
    expect(parsed).toMatchObject({ note: "kept" });
  });

  test("rejects a manifest whose current slot is empty", () => {
    expect(
      mapTilesManifestSchema.safeParse({ current: "b", slots: { a: null, b: null } }).success,
    ).toBe(false);
  });
});
