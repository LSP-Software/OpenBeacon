export const checkGroupKeyAccess = async <Epoch extends { createdAt: Date }>({
  canResolve,
  listEpochs,
}: {
  canResolve: (epoch: Epoch) => Promise<boolean>;
  listEpochs: (cursor: number | null) => Promise<{ epochs: Epoch[]; nextCursor: number | null }>;
}) => {
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
  return { current, history: "complete" as const };
};

export const checkCurrentKeyAccess = async <Epoch>({
  canResolve,
  listLatestEpoch,
}: {
  canResolve: (epoch: Epoch) => Promise<boolean>;
  listLatestEpoch: () => Promise<{ epochs: Epoch[] }>;
}) => {
  const [latest] = (await listLatestEpoch()).epochs;
  if (!latest) return { current: "unavailable" as const };
  return { current: (await canResolve(latest)) ? ("available" as const) : ("missing" as const) };
};

export const checkHistoryRecovery = async <
  Epoch extends { createdAt: Date; historyWraps: { historyKeyVersion: number }[] },
>({
  historyKeyVersion,
  listEpochs,
}: {
  historyKeyVersion: number;
  listEpochs: (cursor: number | null) => Promise<{ epochs: Epoch[]; nextCursor: number | null }>;
}) => {
  let protectedFrom: Date | null = null;
  let cursor: number | null = null;
  do {
    const page = await listEpochs(cursor);
    for (const epoch of page.epochs) {
      if (!epoch.historyWraps.some((wrap) => wrap.historyKeyVersion === historyKeyVersion)) {
        return protectedFrom
          ? { protectedFrom, status: "partial" as const }
          : { status: "none" as const };
      }
      protectedFrom = epoch.createdAt;
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  return { status: "complete" as const };
};
