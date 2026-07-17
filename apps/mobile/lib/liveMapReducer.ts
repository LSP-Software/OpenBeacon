export type LiveMapEntry = {
  battery: {
    charging: boolean;
    level: number;
  };
  latitude: number;
  longitude: number;
  serverCreatedAt: Date;
  serverId: string;
  sourceGroupId: string;
  speed: number | null;
  timestamp: string;
  userId: string;
};

const isNewerThan = (candidate: LiveMapEntry, current: LiveMapEntry) => {
  if (candidate.timestamp > current.timestamp) {
    return true;
  }
  if (candidate.timestamp < current.timestamp) {
    return false;
  }
  if (candidate.serverCreatedAt.getTime() > current.serverCreatedAt.getTime()) {
    return true;
  }
  if (candidate.serverCreatedAt.getTime() < current.serverCreatedAt.getTime()) {
    return false;
  }
  return candidate.serverId > current.serverId;
};

export const reduceLivePositions = (
  current: ReadonlyMap<string, LiveMapEntry>,
  candidates: readonly LiveMapEntry[],
) => {
  const next = new Map(current);

  for (const candidate of candidates) {
    const existing = next.get(candidate.userId);
    if (!existing || isNewerThan(candidate, existing)) {
      next.set(candidate.userId, candidate);
    }
  }

  return next;
};
