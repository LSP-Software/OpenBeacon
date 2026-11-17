export type LiveMapEntry = {
  battery: {
    charging: boolean;
    level: number | null;
  };
  deviceId: string;
  latitude: number;
  longitude: number;
  serverUpdatedAt: Date;
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
  return candidate.serverUpdatedAt.getTime() > current.serverUpdatedAt.getTime();
};

export const reduceLivePositions = (
  current: ReadonlyMap<string, LiveMapEntry>,
  candidates: readonly LiveMapEntry[],
) => {
  let next: Map<string, LiveMapEntry> | null = null;

  for (const candidate of candidates) {
    const existing = (next ?? current).get(candidate.deviceId);
    if (!existing || isNewerThan(candidate, existing)) {
      next ??= new Map(current);
      next.set(candidate.deviceId, candidate);
    }
  }

  return next ?? current;
};

export const dropInactiveDevices = (
  current: ReadonlyMap<string, LiveMapEntry>,
  {
    activeDeviceIds,
    seenAtRequest,
  }: {
    activeDeviceIds: ReadonlySet<string>;
    seenAtRequest: ReadonlyMap<string, LiveMapEntry>;
  },
) => {
  const next = new Map(current);
  for (const [deviceId, entry] of current) {
    if (!activeDeviceIds.has(deviceId) && seenAtRequest.get(deviceId) === entry) {
      next.delete(deviceId);
    }
  }
  return next.size === current.size ? current : next;
};
