export const nextPlaceEditorSelfCentring = ({
  centredOn,
  location,
  movedByUser,
}: {
  centredOn: "nothing" | "cached" | "live";
  location: { cached: boolean } | null;
  movedByUser: boolean;
}): "cached" | "live" | null => {
  if (!location || movedByUser || centredOn === "live") return null;
  if (centredOn === "cached" && location.cached) return null;
  return location.cached ? "cached" : "live";
};
