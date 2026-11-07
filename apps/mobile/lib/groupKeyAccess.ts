export const checkGroupKeyAccess = async <Epoch extends { createdAt: Date }>({
  canResolve,
  listEpochs,
}: {
  canResolve: (epoch: Epoch) => Promise<boolean>;
  listEpochs: (cursor: number | null) => Promise<{ epochs: Epoch[]; nextCursor: number | null }>;
}): Promise<{
  current: "available" | "missing" | "unavailable";
  history: "complete" | { partialFrom: Date };
}> => {
  let current: "available" | "missing" | "unavailable" = "unavailable";
  let readableFrom: Date | null = null;
  let cursor: number | null = null;
  do {
    const page = await listEpochs(cursor);
    for (const epoch of page.epochs) {
      const resolvable = await canResolve(epoch);
      if (current === "unavailable") {
        current = resolvable ? "available" : "missing";
      } else if (!resolvable && readableFrom) {
        return { current, history: { partialFrom: readableFrom } };
      }
      readableFrom = epoch.createdAt;
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  return { current, history: "complete" };
};
