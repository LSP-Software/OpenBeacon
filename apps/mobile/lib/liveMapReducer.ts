export type LiveMapEntry = {
  battery: {
    charging: boolean;
    level: number | null;
  };
  deviceId: string;
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
    const existing = next.get(candidate.deviceId);
    if (!existing || isNewerThan(candidate, existing)) {
      next.set(candidate.deviceId, candidate);
    }
  }

  return next;
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
