import { tryCatch } from "@openbeacon/shared";
import { type LiveMapEntry, reduceLivePositions } from "./liveMapReducer.ts";
import type {
  LiveMapPosition,
  MapTrackingCursor,
  MapTrackingDeps,
  MapTrackingEncryptedPoint,
} from "./mapTrackingTypes.ts";

export type {
  LiveMapPosition,
  MapTrackingCursor,
  MapTrackingDeps,
  MapTrackingEncryptedPoint,
} from "./mapTrackingTypes.ts";

const STEADY_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;
const POLL_LIMIT = 100;

const maxCursor = (points: readonly MapTrackingEncryptedPoint[]): MapTrackingCursor | null => {
  let cursor: MapTrackingCursor | null = null;

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

const isCursorAfter = (candidate: MapTrackingCursor, current: MapTrackingCursor) =>
  candidate.createdAt.getTime() > current.createdAt.getTime() ||
  (candidate.createdAt.getTime() === current.createdAt.getTime() && candidate.id > current.id);

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
  let scheduled: { cancel: () => void } | null = null;
  let tickPromise: Promise<void> | null = null;
  const groupStates = new Map<
    string,
    { cursor: MapTrackingCursor | null; mode: "cold" | "live" }
  >();
  const positionsByGroup = new Map<string, Map<string, LiveMapEntry>>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const getLiveMap = () => {
    let live = new Map<string, LiveMapEntry>();
    for (const groupEntries of positionsByGroup.values()) {
      live = reduceLivePositions(live, [...groupEntries.values()]);
    }
    return live;
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

    if (entries.length === 0) {
      return;
    }

    const groupEntries = positionsByGroup.get(groupId) ?? new Map<string, LiveMapEntry>();
    positionsByGroup.set(groupId, reduceLivePositions(groupEntries, entries));
    notify();
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
      if (!active) {
        return;
      }

      const { points } = await deps.poll({
        cursor,
        groupId,
        limit: POLL_LIMIT,
      });

      if (!active) {
        return;
      }

      if (points.length === 0) {
        break;
      }

      const nextCursor = maxCursor(points);
      if (!nextCursor || !isCursorAfter(nextCursor, cursor)) {
        break;
      }

      await mergeDecrypted({ groupId, points });
      cursor = nextCursor;
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

    for (const groupId of [...groupStates.keys()]) {
      if (!groupIds.has(groupId)) {
        groupStates.delete(groupId);
        positionsByGroup.delete(groupId);
        deps.clearEpochKeys(groupId);
        removedGroups = true;
      }
    }

    if (removedGroups) {
      notify();
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
      positionsByGroup.clear();
      deps.clearEpochKeys();
    },
    getLivePositions: () => [...getLiveMap().values()].map(toLiveMapPosition),
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
