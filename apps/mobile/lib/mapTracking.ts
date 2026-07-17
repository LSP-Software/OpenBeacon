import { tryCatch } from "@openbeacon/shared";
import { type LiveMapEntry, reduceLivePositions } from "./liveMapReducer.ts";

export type MapTrackingEncryptedPoint = {
  algorithm: string;
  ciphertext: string;
  clientPointId: string;
  createdAt: Date;
  epochId: string;
  id: string;
  kind: string;
  nonce: string;
  senderDeviceId: string;
  senderUserId: string;
};

export type LiveMapPosition = Omit<LiveMapEntry, "serverCreatedAt" | "serverId">;

export type MapTrackingDeps = {
  decryptPoint: (input: {
    groupId: string;
    point: MapTrackingEncryptedPoint;
  }) => Promise<
    { entry: LiveMapEntry; status: "ok" } | { status: "ignored" } | { status: "undecryptable" }
  >;
  getLatest: (groupId: string) => Promise<{ points: MapTrackingEncryptedPoint[] }>;
  listGroups: () => Promise<Array<{ id: string }>>;
  now: () => number;
  poll: (input: {
    cursor: { createdAt: Date; id: string } | null;
    groupId: string;
    limit: number;
  }) => Promise<{ points: MapTrackingEncryptedPoint[] }>;
  schedule: (callback: () => void, delayMs: number) => { cancel: () => void };
};

const STEADY_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;
const POLL_LIMIT = 100;

const maxCursor = (points: readonly MapTrackingEncryptedPoint[]) => {
  let cursor: { createdAt: Date; id: string } | null = null;

  for (const point of points) {
    if (
      !cursor ||
      point.createdAt.getTime() > cursor.createdAt.getTime() ||
      (point.createdAt.getTime() === cursor.createdAt.getTime() && point.id > cursor.id)
    ) {
      cursor = { createdAt: point.createdAt, id: point.id };
    }
  }

  return cursor;
};

const toLiveMapPosition = ({
  battery,
  latitude,
  longitude,
  sourceGroupId,
  speed,
  timestamp,
  userId,
}: LiveMapEntry): LiveMapPosition => ({
  battery,
  latitude,
  longitude,
  sourceGroupId,
  speed,
  timestamp,
  userId,
});

export const createMapTrackingSession = (deps: MapTrackingDeps) => {
  let active = false;
  let backoffMs = STEADY_INTERVAL_MS;
  let lastReconcileAt = deps.now();
  let live = new Map<string, LiveMapEntry>();
  let scheduled: { cancel: () => void } | null = null;
  let tickPromise: Promise<void> | null = null;
  const groupStates = new Map<
    string,
    { cursor: { createdAt: Date; id: string } | null; mode: "cold" | "live" }
  >();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const clearSchedule = () => {
    scheduled?.cancel();
    scheduled = null;
  };

  const scheduleNext = (delayMs: number) => {
    clearSchedule();
    if (!active) {
      return;
    }

    scheduled = deps.schedule(() => {
      void tick();
    }, delayMs);
  };

  const mergeDecrypted = async ({
    groupId,
    points,
  }: {
    groupId: string;
    points: readonly MapTrackingEncryptedPoint[];
  }) => {
    const entries: LiveMapEntry[] = [];

    for (const point of points) {
      const result = await deps.decryptPoint({ groupId, point });
      if (result.status === "ok") {
        entries.push(result.entry);
      }
    }

    if (entries.length > 0) {
      live = reduceLivePositions(live, entries);
      notify();
    }
  };

  const coldTick = async (groupId: string) => {
    const { points } = await deps.getLatest(groupId);
    const state = groupStates.get(groupId) ?? { cursor: null, mode: "cold" as const };

    if (points.length === 0) {
      groupStates.set(groupId, state);
      return;
    }

    await mergeDecrypted({ groupId, points });
    groupStates.set(groupId, {
      cursor: maxCursor(points),
      mode: "live",
    });
  };

  const liveTick = async (groupId: string) => {
    const state = groupStates.get(groupId);
    if (!state || state.mode !== "live" || !state.cursor) {
      return;
    }

    let cursor = state.cursor;

    for (;;) {
      const { points } = await deps.poll({
        cursor,
        groupId,
        limit: POLL_LIMIT,
      });

      if (points.length === 0) {
        break;
      }

      await mergeDecrypted({ groupId, points });
      cursor = maxCursor(points) ?? cursor;
      groupStates.set(groupId, { cursor, mode: "live" });

      if (points.length < POLL_LIMIT) {
        break;
      }
    }
  };

  const reconcileTick = async (groupId: string) => {
    const { points } = await deps.getLatest(groupId);
    if (points.length === 0) {
      return;
    }

    await mergeDecrypted({ groupId, points });
  };

  const tickInternal = async () => {
    const groups = await deps.listGroups();
    const groupIds = new Set(groups.map(({ id }) => id));
    let removedGroups = false;

    for (const groupId of groupStates.keys()) {
      if (!groupIds.has(groupId)) {
        groupStates.delete(groupId);
        removedGroups = true;
      }
    }

    if (removedGroups) {
      const nextLive = new Map<string, LiveMapEntry>();
      for (const [userId, entry] of live) {
        if (groupIds.has(entry.sourceGroupId)) {
          nextLive.set(userId, entry);
        }
      }
      if (nextLive.size !== live.size) {
        live = nextLive;
        notify();
      }
    }

    for (const { id: groupId } of groups) {
      if (!groupStates.has(groupId)) {
        groupStates.set(groupId, { cursor: null, mode: "cold" });
      }
    }

    const shouldReconcile = deps.now() - lastReconcileAt >= RECONCILE_INTERVAL_MS;

    await Promise.all(
      groups.map(async ({ id: groupId }) => {
        const state = groupStates.get(groupId);
        if (!state || state.mode === "cold" || !state.cursor) {
          await coldTick(groupId);
          return;
        }

        if (shouldReconcile) {
          await reconcileTick(groupId);
        }

        await liveTick(groupId);
      }),
    );

    if (shouldReconcile) {
      lastReconcileAt = deps.now();
    }
  };

  const tick = async () => {
    if (!active) {
      return;
    }

    if (tickPromise) {
      return tickPromise;
    }

    tickPromise = (async () => {
      const result = await tryCatch(tickInternal());
      if (result.error) {
        scheduleNext(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        return;
      }

      backoffMs = STEADY_INTERVAL_MS;
      scheduleNext(STEADY_INTERVAL_MS);
    })().finally(() => {
      tickPromise = null;
    });

    return tickPromise;
  };

  return {
    destroy: () => {
      active = false;
      clearSchedule();
      listeners.clear();
      groupStates.clear();
      live = new Map();
    },
    getLivePositions: () => [...live.values()].map(toLiveMapPosition),
    setActive: (nextActive: boolean) => {
      if (active === nextActive) {
        if (nextActive) {
          void tick();
        }
        return;
      }

      active = nextActive;
      if (!active) {
        clearSchedule();
        return;
      }

      void tick();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    tick,
  };
};
