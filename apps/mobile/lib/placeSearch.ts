import type {
  PlaceSearchAddress,
  PlaceSearchOutcome,
} from "../modules/openbeacon-tracking/index.ts";

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

export const placeSearchState = (
  outcome: PlaceSearchOutcome,
):
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "noResults" }
  | { kind: "move"; label: string; latitude: number; longitude: number } => {
  if (outcome.status === "unavailable") return { kind: "unavailable" };
  if (outcome.status === "error") return { kind: "error" };
  const result = outcome.results.find(
    ({ latitude, longitude }) =>
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180,
  );
  if (!result) return { kind: "noResults" };
  return {
    kind: "move",
    label: placeSearchLabel(result),
    latitude: result.latitude,
    longitude: result.longitude,
  };
};
