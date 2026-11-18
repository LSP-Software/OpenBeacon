import { beforeEach, expect, mock, test } from "bun:test";
import { PbfWriter } from "pbf";

const stored = new Map<string, string>();
const tiles = new Map<string, ArrayBuffer>();
const tileRequests: string[] = [];
const sources: {
  getBytes: (offset: number, length: number) => Promise<{ data: ArrayBuffer }>;
}[] = [];

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => {
      stored.set(key, value);
    },
    remove: (key: string) => stored.delete(key),
    getAllKeys: () => [...stored.keys()],
  },
}));

mock.module("pmtiles", () => ({
  Compression: { Unknown: 0, None: 1, Gzip: 2 },
  PMTiles: class {
    constructor(source: (typeof sources)[number]) {
      sources.push(source);
    }
    getZxy = async (z: number, x: number, y: number) => {
      tileRequests.push(`${z}/${x}/${y}`);
      const data = tiles.get(`${z}/${x}/${y}`);
      return data ? { data } : undefined;
    };
  },
}));

const {
  clearAreaNames,
  distanceToTile,
  findAreaName,
  lookupAreaName,
  MAX_AREA_DISTANCE_METERS,
  placeContaining,
  readAreaPlaces,
  tileForPoint,
} = await import("./memberArea.ts");

const tooting = { latitude: 51.4275, longitude: -0.168 };

const zigzag = (value: number) => (value << 1) ^ (value >> 31);

const encodePlacesTile = (
  features: readonly { kind: string; name?: string; nameEn?: string; x: number; y: number }[],
) => {
  const keys = ["kind", "name", "name:en"];
  const values: string[] = [];
  const valueIndex = (value: string) => {
    const index = values.indexOf(value);
    if (index >= 0) return index;
    values.push(value);
    return values.length - 1;
  };
  const pbf = new PbfWriter();
  pbf.writeMessage(
    3,
    (_: undefined, layer: PbfWriter) => {
      layer.writeVarintField(15, 2);
      layer.writeStringField(1, "places");
      for (const feature of features) {
        const tags = [0, valueIndex(feature.kind)];
        if (feature.name) tags.push(1, valueIndex(feature.name));
        if (feature.nameEn) tags.push(2, valueIndex(feature.nameEn));
        layer.writeMessage(
          2,
          (_: undefined, message: PbfWriter) => {
            message.writePackedVarint(2, tags);
            message.writeVarintField(3, 1);
            message.writePackedVarint(4, [9, zigzag(feature.x), zigzag(feature.y)]);
          },
          undefined,
        );
      }
      for (const key of keys) layer.writeStringField(3, key);
      for (const value of values) {
        layer.writeMessage(
          4,
          (_: undefined, message: PbfWriter) => {
            message.writeStringField(1, value);
          },
          undefined,
        );
      }
      layer.writeVarintField(5, 4096);
    },
    undefined,
  );
  const bytes = pbf.finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

beforeEach(() => {
  stored.clear();
  tiles.clear();
  tileRequests.length = 0;
  sources.length = 0;
  clearAreaNames();
});

test("finds the z11 tile that holds a point", () => {
  expect(tileForPoint(tooting)).toEqual({ x: 1023, y: 681 });
  expect(tileForPoint({ latitude: -89.9, longitude: 180 })).toEqual({ x: 2047, y: 2047 });
});

test("measures zero inside a tile and the gap to a tile beside it", () => {
  const { x, y } = tileForPoint(tooting);
  expect(distanceToTile({ point: tooting, x, y })).toBe(0);
  const east = distanceToTile({ point: tooting, x: x + 1, y });
  expect(east).toBeGreaterThan(0);
  expect(east).toBeLessThan(14_000);
});

test("reads town and suburb names from a tile and skips other kinds", () => {
  const places = readAreaPlaces({
    data: encodePlacesTile([
      { kind: "locality", name: "Tooting", x: 2048, y: 2048 },
      { kind: "neighbourhood", name: "Köln-Süd", nameEn: "Cologne South", x: 0, y: 0 },
      { kind: "country", name: "United Kingdom", x: 100, y: 100 },
      { kind: "locality", x: 200, y: 200 },
    ]),
    x: 1023,
    y: 681,
  });

  expect(places.map((place) => place.name)).toEqual(["Tooting", "Cologne South"]);
  const centre = places[0];
  const corner = places[1];
  expect(centre?.longitude).toBeCloseTo(-0.0879, 3);
  expect(centre?.latitude).toBeCloseTo(51.454, 3);
  expect(corner?.longitude).toBeCloseTo(-0.1758, 3);
  expect(corner?.latitude).toBeCloseTo(51.5087, 3);
});

test("uses the nearest name in the member's own tile without loading neighbours", async () => {
  const centre = { latitude: 51.4743, longitude: -0.0879 };
  const loaded: string[] = [];

  const name = await findAreaName({
    point: centre,
    loadTile: async ({ x, y }) => {
      loaded.push(`${x}/${y}`);
      return [
        { latitude: 51.47, longitude: -0.09, name: "Peckham" },
        { latitude: 51.48, longitude: -0.12, name: "Vauxhall" },
      ];
    },
  });

  expect(name).toBe("Peckham");
  expect(loaded).toEqual(["1023/681"]);
});

test("looks in the next tile when the member is near its edge", async () => {
  const nearEastEdge = { latitude: 51.4743, longitude: -0.0005 };
  const loaded: string[] = [];

  const name = await findAreaName({
    point: nearEastEdge,
    loadTile: async ({ x, y }) => {
      loaded.push(`${x}/${y}`);
      if (x === 1023 && y === 681)
        return [{ latitude: 51.4743, longitude: -0.06, name: "New Cross" }];
      if (x === 1024 && y === 681)
        return [{ latitude: 51.4743, longitude: 0.004, name: "Greenwich" }];
      return [];
    },
  });

  expect(name).toBe("Greenwich");
  expect(loaded[0]).toBe("1023/681");
  expect(loaded).toContain("1024/681");
  expect(loaded).not.toContain("1022/681");
});

test("shows no area when nothing named is close", async () => {
  const point = { latitude: 51.4743, longitude: -0.0879 };
  const farAway = MAX_AREA_DISTANCE_METERS / 111_000 + 0.01;

  const name = await findAreaName({
    point,
    loadTile: async () => [
      { latitude: point.latitude + farAway, longitude: point.longitude, name: "Far" },
    ],
  });

  expect(name).toBeNull();
});

test("prefers the smallest group place the member is inside", () => {
  const places = [
    { latitude: 51.4275, longitude: -0.168, name: "Town", radiusMeters: 1000 },
    { latitude: 51.4276, longitude: -0.168, name: "Home", radiusMeters: 100 },
    { latitude: 51.5, longitude: -0.1, name: "Work", radiusMeters: 250 },
  ];

  expect(placeContaining({ places, point: tooting })?.name).toBe("Home");
  expect(placeContaining({ places, point: { latitude: 51.45, longitude: -0.168 } })).toBeNull();
});

test("keeps names from fetched tiles so a repeat lookup makes no request", async () => {
  tiles.set(
    "11/1023/681",
    encodePlacesTile([{ kind: "locality", name: "Tooting", x: 1500, y: 3900 }]),
  );

  const first = await lookupAreaName({ archiveId: "a-1", point: tooting, url: "https://m/a" });
  const requestsAfterFirst = tileRequests.length;
  const second = await lookupAreaName({ archiveId: "a-1", point: tooting, url: "https://m/a" });

  expect(first).toBe("Tooting");
  expect(second).toBe("Tooting");
  expect(tileRequests.length).toBe(requestsAfterFirst);
  expect(stored.get("memberArea.11/1023/681")).toContain("Tooting");
});

test("a new map build drops names saved from the old one", async () => {
  stored.set("memberArea.archiveId", "a-1");
  stored.set(
    "memberArea.11/1023/681",
    JSON.stringify([{ latitude: 51.4275, longitude: -0.168, name: "Old" }]),
  );
  stored.set("memberArea.11/5/5", "[]");
  tiles.set(
    "11/1023/681",
    encodePlacesTile([{ kind: "locality", name: "Tooting", x: 1500, y: 3900 }]),
  );

  const name = await lookupAreaName({ archiveId: "b-2", point: tooting, url: "https://m/b" });

  expect(name).toBe("Tooting");
  expect(stored.get("memberArea.archiveId")).toBe("b-2");
  expect(stored.has("memberArea.11/5/5")).toBe(false);
});

test("refuses a map response that ignores the byte range", async () => {
  const originalFetch = globalThis.fetch;
  const requested: { range: string | null; url: string }[] = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    requested.push({ range: new Headers(init?.headers).get("Range"), url: input });
    return new Response("whole archive", { status: 200 });
  }) as typeof fetch;

  await lookupAreaName({ archiveId: "a-1", point: tooting, url: "https://m/signed" });
  const source = sources[0];
  const result = source?.getBytes(0, 16384);

  await expect(result).rejects.toThrow("Map range request failed: 200");
  expect(requested).toEqual([{ range: "bytes=0-16383", url: "https://m/signed" }]);
  globalThis.fetch = originalFetch;
});
