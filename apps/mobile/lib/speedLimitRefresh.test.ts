import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  refreshSpeedLimitPacks,
  regionAt,
  type SpeedLimitBoundaries,
} from "./speedLimitRefresh.ts";

const square = (west: number, south: number, east: number, north: number): [number, number][] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

const boundaries: SpeedLimitBoundaries = {
  format: 1,
  regions: [
    {
      id: "europe/great-britain",
      geometry: {
        type: "MultiPolygon",
        coordinates: [[square(-6, 50, 2, 56)], [square(-8, 54, -5.5, 55.3)]],
      },
    },
    {
      id: "europe/france",
      geometry: { type: "Polygon", coordinates: [square(-5, 42, 8, 51), square(1, 45, 2, 46)] },
    },
    {
      id: "europe/jersey",
      geometry: { type: "Polygon", coordinates: [square(-2.3, 49.1, -2, 49.3)] },
    },
  ],
};

const boundariesText = JSON.stringify(boundaries);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const london = { latitude: 51.5, longitude: -0.1 };
const day = 24 * 60 * 60 * 1000;

const signed = (packSha = "a".repeat(64)) => ({
  build: "20261201",
  boundaries: {
    url: "https://storage.test/boundaries",
    size: boundariesText.length,
    sha256: sha256(boundariesText),
  },
  regions: [
    {
      id: "europe/great-britain",
      size: 60_000_000,
      sha256: packSha,
      url: "https://storage.test/gb",
    },
    {
      id: "europe/france",
      size: 90_000_000,
      sha256: "b".repeat(64),
      url: "https://storage.test/fr",
    },
  ],
});

const rig = ({
  detectionOn = true,
  recording = false,
  onWifi = true,
  position = london as { latitude: number; longitude: number } | null,
  cachedBoundaries = null as string | null,
  installed = [] as { regionId: string; sha256: string }[],
  state = { checkedAt: 0, regionAt: 0, waitingForWifi: false },
  now = 10 * day,
  served = signed() as ReturnType<typeof signed> | null,
  servedBoundaries = boundariesText,
} = {}) => {
  const calls: string[] = [];
  const downloads: unknown[] = [];
  const saved = { boundaries: cachedBoundaries, state: { ...state } };
  const deps = {
    now: () => now,
    detectionOn: () => detectionOn,
    recording: () => recording,
    onWifi: async () => onWifi,
    position: async () => position,
    readState: () => saved.state,
    writeState: (next: { checkedAt: number; regionAt: number; waitingForWifi: boolean }) => {
      saved.state = next;
    },
    readBoundaries: async () => saved.boundaries,
    writeBoundaries: async (text: string) => {
      saved.boundaries = text;
    },
    fetchSignedPacks: async () => {
      calls.push("sign");
      return served;
    },
    fetchText: async (url: string) => {
      calls.push(`fetch ${url}`);
      return servedBoundaries;
    },
    sha256: async (text: string) => sha256(text),
    installed: async () => installed,
    noteRegion: async (regionId: string) => {
      calls.push(`note ${regionId}`);
    },
    download: (request: unknown) => {
      downloads.push(request);
    },
  };
  return { calls, deps, downloads, saved };
};

describe("regionAt", () => {
  test("finds the region whose boundary holds the point", () => {
    expect(regionAt(boundaries, london)).toBe("europe/great-britain");
    expect(regionAt(boundaries, { latitude: 54.6, longitude: -6 })).toBe("europe/great-britain");
    expect(regionAt(boundaries, { latitude: 48.8, longitude: 2.3 })).toBe("europe/france");
  });

  test("leaves out holes and places outside every region", () => {
    expect(regionAt(boundaries, { latitude: 45.5, longitude: 1.5 })).toBeNull();
    expect(regionAt(boundaries, { latitude: 40, longitude: -30 })).toBeNull();
  });

  test("picks the smaller region where two overlap", () => {
    expect(regionAt(boundaries, { latitude: 49.2, longitude: -2.1 })).toBe("europe/jersey");
  });
});

describe("refreshSpeedLimitPacks", () => {
  test("does nothing while Drive detection is off", async () => {
    const { calls, deps, downloads } = rig({
      detectionOn: false,
      cachedBoundaries: boundariesText,
    });
    await refreshSpeedLimitPacks(deps);
    expect(calls).toEqual([]);
    expect(downloads).toEqual([]);
  });

  test("notes the region but asks the server for nothing off Wi-Fi", async () => {
    const { calls, deps, downloads } = rig({ onWifi: false, cachedBoundaries: boundariesText });
    await refreshSpeedLimitPacks(deps);
    expect(calls).toEqual(["note europe/great-britain"]);
    expect(downloads).toEqual([]);
  });

  test("asks the server for nothing during a Drive", async () => {
    const { calls, deps, downloads } = rig({ recording: true, cachedBoundaries: boundariesText });
    await refreshSpeedLimitPacks(deps);
    expect(calls).toEqual(["note europe/great-britain"]);
    expect(downloads).toEqual([]);
  });

  test("a round off Wi-Fi doesn't hold back the download once Wi-Fi is back", async () => {
    const offline = rig({ onWifi: false, cachedBoundaries: boundariesText });
    await refreshSpeedLimitPacks(offline.deps);
    const online = rig({
      cachedBoundaries: boundariesText,
      state: offline.saved.state,
      now: 10 * day + 60_000,
    });
    await refreshSpeedLimitPacks(online.deps);
    expect(online.downloads).toEqual([
      expect.objectContaining({ regionId: "europe/great-britain" }),
    ]);
  });

  test("off Wi-Fi with an up-to-date pack, the next round still waits 30 minutes", async () => {
    const installed = [{ regionId: "europe/great-britain", sha256: "a".repeat(64) }];
    const offline = rig({
      onWifi: false,
      cachedBoundaries: boundariesText,
      installed,
      state: { checkedAt: 10 * day - 60_000, regionAt: 0, waitingForWifi: false },
    });
    await refreshSpeedLimitPacks(offline.deps);
    const online = rig({
      cachedBoundaries: boundariesText,
      installed,
      state: offline.saved.state,
      now: 10 * day + 60_000,
    });
    await refreshSpeedLimitPacks(online.deps);
    expect(online.calls).toEqual([]);
  });

  test("checks again only after 30 minutes", async () => {
    const { calls, deps } = rig({
      cachedBoundaries: boundariesText,
      state: { checkedAt: 0, regionAt: 10 * day - 29 * 60 * 1000, waitingForWifi: false },
    });
    await refreshSpeedLimitPacks(deps);
    expect(calls).toEqual([]);
  });

  test("on Wi-Fi fetches the boundaries, then downloads the pack for the region it is in", async () => {
    const { calls, deps, downloads, saved } = rig();
    await refreshSpeedLimitPacks(deps);
    expect(calls).toEqual([
      "sign",
      "fetch https://storage.test/boundaries",
      "note europe/great-britain",
    ]);
    expect(saved.boundaries).toBe(boundariesText);
    expect(downloads).toEqual([
      {
        regionId: "europe/great-britain",
        build: "20261201",
        url: "https://storage.test/gb",
        size: 60_000_000,
        sha256: "a".repeat(64),
      },
    ]);
    expect(saved.state.checkedAt).toBe(0);
  });

  test("refuses boundaries that don't match the server's list", async () => {
    const { deps, downloads, saved } = rig({
      servedBoundaries: boundariesText.replace("56", "57"),
    });
    await refreshSpeedLimitPacks(deps);
    expect(saved.boundaries).toBeNull();
    expect(downloads).toEqual([]);
  });

  test("leaves an up-to-date pack alone and waits a day before asking again", async () => {
    const installed = [{ regionId: "europe/great-britain", sha256: "a".repeat(64) }];
    const first = rig({ cachedBoundaries: boundariesText, installed });
    await refreshSpeedLimitPacks(first.deps);
    expect(first.calls).toEqual(["note europe/great-britain", "sign"]);
    expect(first.downloads).toEqual([]);
    expect(first.saved.state.checkedAt).toBe(10 * day);

    const next = rig({
      cachedBoundaries: boundariesText,
      installed,
      state: { checkedAt: 10 * day - day + 60_000, regionAt: 0, waitingForWifi: false },
    });
    await refreshSpeedLimitPacks(next.deps);
    expect(next.calls).toEqual(["note europe/great-britain"]);
  });

  test("downloads a newer build of the pack it already has after a day", async () => {
    const { deps, downloads } = rig({
      cachedBoundaries: boundariesText,
      installed: [{ regionId: "europe/great-britain", sha256: "c".repeat(64) }],
      state: { checkedAt: 9 * day, regionAt: 0, waitingForWifi: false },
    });
    await refreshSpeedLimitPacks(deps);
    expect(downloads).toEqual([expect.objectContaining({ sha256: "a".repeat(64) })]);
  });

  test("waits a day when the server has no packs yet", async () => {
    const { deps, downloads, saved } = rig({ served: null });
    await refreshSpeedLimitPacks(deps);
    expect(downloads).toEqual([]);
    expect(saved.state.checkedAt).toBe(10 * day);
  });
});
