import type {
  PlaceSearchAddress,
  PlaceSearchBox,
  PlaceSearchOutcome,
} from "../modules/openbeacon-tracking/index.ts";
import { metersBetween } from "./places.ts";

export const placeSearchLabel = (address: PlaceSearchAddress) => {
  const line = address.addressLine?.trim();
  if (line) return line;
  return [
    [address.houseNumber, address.street].filter(Boolean).join(" "),
    address.subLocality ?? address.locality,
    address.postcode,
  ]
    .filter(Boolean)
    .join(", ");
};

export type PlaceSearchResult = {
  distance: "near" | "further" | null;
  label: string;
  latitude: number;
  longitude: number;
};

export const placeSearchState = ({
  anywhere,
  near,
}: {
  anywhere: PlaceSearchOutcome;
  near: { area: PlaceSearchBox; outcome: PlaceSearchOutcome } | null;
}):
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "noResults" }
  | { kind: "move"; result: PlaceSearchResult }
  | { kind: "choose"; results: PlaceSearchResult[] } => {
  const outcomes = near ? [near.outcome, anywhere] : [anywhere];
  if (outcomes.some(({ status }) => status === "unavailable")) return { kind: "unavailable" };
  const usable = (outcome: PlaceSearchOutcome) =>
    outcome.status === "results"
      ? outcome.results.filter(
          ({ latitude, longitude }) =>
            Number.isFinite(latitude) &&
            Number.isFinite(longitude) &&
            Math.abs(latitude) <= 90 &&
            Math.abs(longitude) <= 180,
        )
      : [];
  const inArea = ({ latitude, longitude }: PlaceSearchAddress) =>
    !!near &&
    latitude >= near.area.south &&
    latitude <= near.area.north &&
    (near.area.west <= near.area.east
      ? longitude >= near.area.west && longitude <= near.area.east
      : longitude >= near.area.west || longitude <= near.area.east);
  const merged: PlaceSearchResult[] = [];
  for (const address of [...(near ? usable(near.outcome) : []), ...usable(anywhere)]) {
    if (merged.some((result) => metersBetween(result, address) <= 50)) continue;
    merged.push({
      distance: near ? (inArea(address) ? "near" : "further") : null,
      label: placeSearchLabel(address),
      latitude: address.latitude,
      longitude: address.longitude,
    });
  }
  const results = merged
    .filter(({ distance }) => distance !== "further")
    .concat(merged.filter(({ distance }) => distance === "further"))
    .slice(0, 5);
  const [first] = results;
  if (!first) {
    return outcomes.some(({ status }) => status === "error")
      ? { kind: "error" }
      : { kind: "noResults" };
  }
  return results.length === 1 ? { kind: "move", result: first } : { kind: "choose", results };
};

export const placeSearchArea = (
  view: {
    bounds: readonly [west: number, south: number, east: number, north: number];
    center: readonly [longitude: number, latitude: number];
  } | null,
): PlaceSearchBox | null => {
  if (!view) return null;
  const [west, south, east, north] = view.bounds;
  const width = east >= west ? east - west : east - west + 360;
  const height = north - south;
  if (width > 20 || height > 20) return null;
  if (width > 0.5 || height > 0.5) return { south, west, north, east };
  const snap = (value: number) => Math.round(value / 0.25) * 0.25 + 0;
  const latitude = snap(view.center[1]);
  const longitude = snap(view.center[0]);
  return {
    south: Math.max(-90, latitude - 0.25),
    west: Math.max(-180, longitude - 0.25),
    north: Math.min(90, latitude + 0.25),
    east: Math.min(180, longitude + 0.25),
  };
};
