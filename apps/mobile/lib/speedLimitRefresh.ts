import { z } from "zod";
import { parseJson } from "./parseJson.ts";

const ringSchema = z.array(z.tuple([z.number(), z.number()])).min(4);

const boundariesSchema = z.object({
  format: z.literal(1),
  regions: z.array(
    z.object({
      id: z.string().min(1),
      geometry: z.discriminatedUnion("type", [
        z.object({ type: z.literal("Polygon"), coordinates: z.array(ringSchema).min(1) }),
        z.object({
          type: z.literal("MultiPolygon"),
          coordinates: z.array(z.array(ringSchema).min(1)).min(1),
        }),
      ]),
    }),
  ),
});

type Position = { latitude: number; longitude: number };

const insideRing = (ring: [number, number][], { latitude, longitude }: Position) => {
  let inside = false;
  ring.forEach(([lonA, latA], index) => {
    const [lonB, latB] = ring[(index || ring.length) - 1] ?? [lonA, latA];
    if (
      latA > latitude !== latB > latitude &&
      longitude < ((lonB - lonA) * (latitude - latA)) / (latB - latA) + lonA
    ) {
      inside = !inside;
    }
  });
  return inside;
};

const ringArea = (ring: [number, number][]) =>
  Math.abs(
    ring.reduce((sum, [lon, lat], index) => {
      const [nextLon, nextLat] = ring[(index + 1) % ring.length] ?? [lon, lat];
      return sum + lon * nextLat - nextLon * lat;
    }, 0) / 2,
  );

export type SpeedLimitBoundaries = z.infer<typeof boundariesSchema>;

export const regionAt = (boundaries: SpeedLimitBoundaries, position: Position) => {
  let best: { id: string; area: number } | null = null;
  for (const region of boundaries.regions) {
    const polygons =
      region.geometry.type === "Polygon"
        ? [region.geometry.coordinates]
        : region.geometry.coordinates;
    const outer = polygons
      .filter(
        ([first, ...holes]) =>
          first !== undefined &&
          insideRing(first, position) &&
          !holes.some((hole) => insideRing(hole, position)),
      )
      .map(([first]) => first)[0];
    if (!outer) continue;
    const area = ringArea(outer);
    if (!best || area < best.area) best = { id: region.id, area };
  }
  return best?.id ?? null;
};

const parseBoundaries = (text: string | null) => {
  if (!text) return null;
  const parsed = boundariesSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
};

const REGION_EVERY_MS = 30 * 60 * 1000;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export const refreshSpeedLimitPacks = async (deps: {
  now: () => number;
  detectionOn: () => boolean;
  recording: () => boolean;
  onWifi: () => Promise<boolean>;
  position: () => Promise<Position | null>;
  readState: () => { checkedAt: number; regionAt: number };
  writeState: (state: { checkedAt: number; regionAt: number }) => void;
  readBoundaries: () => Promise<string | null>;
  writeBoundaries: (text: string) => Promise<void>;
  fetchSignedPacks: () => Promise<{
    build: string;
    boundaries: { url: string; size: number; sha256: string };
    regions: { id: string; size: number; sha256: string; url: string }[];
  } | null>;
  fetchText: (url: string) => Promise<string>;
  sha256: (text: string) => Promise<string>;
  installed: () => Promise<{ regionId: string; sha256: string }[]>;
  noteRegion: (regionId: string) => Promise<void>;
  download: (request: {
    regionId: string;
    build: string;
    url: string;
    size: number;
    sha256: string;
  }) => void;
}) => {
  if (!deps.detectionOn()) return;
  const now = deps.now();
  const state = deps.readState();
  if (now - state.regionAt < REGION_EVERY_MS) return;
  const position = await deps.position();
  if (!position) return;
  deps.writeState({ ...state, regionAt: now });

  const cachedText = await deps.readBoundaries();
  let boundaries = parseBoundaries(cachedText);
  let region = boundaries ? regionAt(boundaries, position) : null;
  if (region) await deps.noteRegion(region);

  if (deps.recording() || !(await deps.onWifi())) return;
  const installed = await deps.installed();
  const current = installed.find(({ regionId }) => regionId === region);
  if (current && now - state.checkedAt < CHECK_EVERY_MS) return;

  const signed = await deps.fetchSignedPacks();
  const checked = () => deps.writeState({ checkedAt: now, regionAt: now });
  if (!signed) return checked();

  if (!boundaries || (await deps.sha256(cachedText ?? "")) !== signed.boundaries.sha256) {
    const text = await deps.fetchText(signed.boundaries.url);
    if (
      text.length !== signed.boundaries.size ||
      (await deps.sha256(text)) !== signed.boundaries.sha256
    )
      return;
    boundaries = parseBoundaries(text);
    if (!boundaries) return;
    await deps.writeBoundaries(text);
    const found = regionAt(boundaries, position);
    if (found && found !== region) await deps.noteRegion(found);
    region = found;
  }

  const pack = signed.regions.find(({ id }) => id === region);
  if (!pack) return checked();
  if (installed.some(({ regionId, sha256 }) => regionId === pack.id && sha256 === pack.sha256)) {
    return checked();
  }
  if (deps.recording()) return;
  deps.download({
    regionId: pack.id,
    build: signed.build,
    url: pack.url,
    size: pack.size,
    sha256: pack.sha256,
  });
};
