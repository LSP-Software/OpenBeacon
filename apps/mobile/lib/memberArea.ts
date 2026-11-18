import { VectorTile } from "@mapbox/vector-tile";
import { tryCatch } from "@openbeacon/shared";
import { gunzipSync } from "fflate";
import { PbfReader } from "pbf";
import { Compression, PMTiles } from "pmtiles";
import { z } from "zod";
import { parseJson } from "./parseJson.ts";
import { metersBetween } from "./places.ts";
import { storage } from "./storage.ts";

export const AREA_ZOOM = 11;
export const MAX_AREA_DISTANCE_METERS = 10_000;

const cacheKeyPrefix = "memberArea.";
const cachedArchiveIdKey = `${cacheKeyPrefix}archiveId`;

const areaPlacesSchema = z.array(
  z.object({ latitude: z.number(), longitude: z.number(), name: z.string() }),
);

type Point = { latitude: number; longitude: number };
type AreaPlace = z.infer<typeof areaPlacesSchema>[number];

export const tileForPoint = ({ latitude, longitude }: Point) => {
  const count = 2 ** AREA_ZOOM;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) *
    count;
  return {
    x: Math.min(Math.max(Math.floor(((longitude + 180) / 360) * count), 0), count - 1),
    y: Math.min(Math.max(Math.floor(y), 0), count - 1),
  };
};

const tileLongitude = (x: number) => (x / 2 ** AREA_ZOOM) * 360 - 180;

const tileLatitude = (y: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** AREA_ZOOM))) * 180) / Math.PI;

export const distanceToTile = ({ point, x, y }: { point: Point; x: number; y: number }) =>
  metersBetween(point, {
    latitude: Math.min(Math.max(point.latitude, tileLatitude(y + 1)), tileLatitude(y)),
    longitude: Math.min(Math.max(point.longitude, tileLongitude(x)), tileLongitude(x + 1)),
  });

export const readAreaPlaces = ({ data, x, y }: { data: ArrayBuffer; x: number; y: number }) => {
  const layer = new VectorTile(new PbfReader(new Uint8Array(data))).layers["places"];
  if (!layer) return [];
  const places: AreaPlace[] = [];
  for (let index = 0; index < layer.length; index++) {
    const feature = layer.feature(index);
    const kind = feature.properties["kind"];
    if (kind !== "locality" && kind !== "neighbourhood" && kind !== "macrohood") continue;
    const name = feature.properties["name:en"] ?? feature.properties["name"];
    const point = feature.loadGeometry()[0]?.[0];
    if (typeof name !== "string" || name.length === 0 || !point) continue;
    places.push({
      latitude: tileLatitude(y + point.y / layer.extent),
      longitude: tileLongitude(x + point.x / layer.extent),
      name,
    });
  }
  return places;
};

export const nearestAreaName = ({
  places,
  point,
}: {
  places: readonly AreaPlace[];
  point: Point;
}) => {
  let nearest: { distance: number; name: string } | null = null;
  for (const place of places) {
    const distance = metersBetween(point, place);
    if (distance <= MAX_AREA_DISTANCE_METERS && (!nearest || distance < nearest.distance)) {
      nearest = { distance, name: place.name };
    }
  }
  return nearest;
};

export const findAreaName = async ({
  loadTile,
  point,
}: {
  loadTile: (tile: { x: number; y: number }) => Promise<readonly AreaPlace[]>;
  point: Point;
}) => {
  const { x, y } = tileForPoint(point);
  let nearest = nearestAreaName({ places: await loadTile({ x, y }), point });
  const neighbours = [-1, 0, 1]
    .flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: x + dx, y: y + dy })))
    .filter((tile) => (tile.x !== x || tile.y !== y) && tile.y >= 0 && tile.y < 2 ** AREA_ZOOM)
    .map((tile) => ({
      ...tile,
      x: (tile.x + 2 ** AREA_ZOOM) % 2 ** AREA_ZOOM,
      distance: distanceToTile({ point, ...tile }),
    }))
    .sort((first, second) => first.distance - second.distance);
  for (const tile of neighbours) {
    if (tile.distance > (nearest?.distance ?? MAX_AREA_DISTANCE_METERS)) break;
    const found = nearestAreaName({ places: await loadTile(tile), point });
    if (found && (!nearest || found.distance < nearest.distance)) nearest = found;
  }
  return nearest?.name ?? null;
};

let archive: { archiveId: string; pmtiles: PMTiles; url: string } | null = null;
const inFlightTiles = new Map<string, Promise<AreaPlace[]>>();

const pmtilesFor = ({ archiveId, url }: { archiveId: string; url: string }) => {
  if (archive?.archiveId === archiveId) {
    archive.url = url;
    return archive.pmtiles;
  }
  const pmtiles = new PMTiles(
    {
      getKey: () => archiveId,
      getBytes: async (offset, length, signal) => {
        const response = await fetch(archive?.url ?? url, {
          headers: { Range: `bytes=${offset}-${offset + length - 1}` },
          signal: signal ?? null,
        });
        if (response.status !== 206)
          throw new Error(`Map range request failed: ${response.status}`);
        return { data: await response.arrayBuffer() };
      },
    },
    undefined,
    async (data, compression) => {
      if (compression === Compression.None || compression === Compression.Unknown) return data;
      if (compression !== Compression.Gzip) throw new Error("Unsupported map compression");
      const unzipped = gunzipSync(new Uint8Array(data));
      return unzipped.buffer.slice(
        unzipped.byteOffset,
        unzipped.byteOffset + unzipped.byteLength,
      ) as ArrayBuffer;
    },
  );
  archive = { archiveId, pmtiles, url };
  return pmtiles;
};

const loadCachedTile = async ({
  archiveId,
  url,
  x,
  y,
}: {
  archiveId: string;
  url: string;
  x: number;
  y: number;
}) => {
  if (storage.getString(cachedArchiveIdKey) !== archiveId) {
    clearCachedAreaPlaces();
    storage.set(cachedArchiveIdKey, archiveId);
  }
  const key = `${cacheKeyPrefix}${AREA_ZOOM}/${x}/${y}`;
  const cached = areaPlacesSchema.safeParse(parseJson(storage.getString(key) ?? ""));
  if (cached.success) return cached.data;

  const inFlightKey = `${archiveId}:${key}`;
  const existing = inFlightTiles.get(inFlightKey);
  if (existing) return existing;
  const load = (async () => {
    const tile = await pmtilesFor({ archiveId, url }).getZxy(AREA_ZOOM, x, y);
    const places = tile ? readAreaPlaces({ data: tile.data, x, y }) : [];
    if (storage.getString(cachedArchiveIdKey) === archiveId) {
      storage.set(key, JSON.stringify(places));
    }
    return places;
  })();
  inFlightTiles.set(inFlightKey, load);
  const result = await tryCatch(load);
  inFlightTiles.delete(inFlightKey);
  if (result.error) throw result.error;
  return result.data;
};

export const placeContaining = <T extends Point & { radiusMeters: number }>({
  places,
  point,
}: {
  places: readonly T[];
  point: Point;
}) =>
  places
    .filter((place) => metersBetween(place, point) <= place.radiusMeters)
    .sort((first, second) => first.radiusMeters - second.radiusMeters)[0] ?? null;

export const lookupAreaName = ({
  archiveId,
  point,
  url,
}: {
  archiveId: string;
  point: Point;
  url: string;
}) => findAreaName({ point, loadTile: ({ x, y }) => loadCachedTile({ archiveId, url, x, y }) });

const clearCachedAreaPlaces = () => {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(cacheKeyPrefix)) storage.remove(key);
  }
};

export const clearAreaNames = () => {
  archive = null;
  clearCachedAreaPlaces();
};
