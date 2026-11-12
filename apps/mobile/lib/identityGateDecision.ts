export const identityGateDecision = (
  status: { freshForMs: number | null; sessionFresh: boolean } | undefined,
): "confirm" | "ready" => {
  if (!status?.sessionFresh) return "confirm";
  if (status.freshForMs === null) return "ready";
  return status.freshForMs >= 10 * 60 * 1000 ? "ready" : "confirm";
};
