import type {
  PlaceSearchAddress,
  PlaceSearchOutcome,
} from "../modules/openbeacon-tracking/index.ts";

export const placeSearchLabel = (address: PlaceSearchAddress) => {
  const parts = (address.addressLine ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length > 1 && !/\d/.test(parts.at(-1) ?? "")) parts.pop();
  if (parts.length > 0) return parts.join(", ");
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
