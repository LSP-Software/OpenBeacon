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
  let scheduled: { cancel: () => void } | null = null;
  let tickPromise: Promise<void> | null = null;
  let tickPhase: "idle" | "listing" | "groups" = "idle";
  const groupStates = new Map<
    string,
    {
      backoffMs: number;
      cursor: MapTrackingCursor | null;
      inFlight: boolean;
      lastReconcileAt: number;
      mode: "cold" | "live";
      nextDueAt: number;
      runId: number;
    }
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

  const isCurrent = (groupId: string, runId: number) => {
    if (!active) {
      return false;
    }
    const state = groupStates.get(groupId);
    return state !== undefined && state.runId === runId;
  };

  const ensureGroupState = (groupId: string) => {
    const existing = groupStates.get(groupId);
    if (existing) {
      return existing;
    }

    const created = {
      backoffMs: STEADY_INTERVAL_MS,
      cursor: null,
      inFlight: false,
      lastReconcileAt: deps.now(),
      mode: "cold" as const,
      nextDueAt: deps.now(),
      runId: 0,
    };
    groupStates.set(groupId, created);
    return created;
  };

  const removeGroup = (groupId: string, { clearKeys = true }: { clearKeys?: boolean } = {}) => {
    const state = groupStates.get(groupId);
    if (state) {
      state.runId += 1;
      state.inFlight = false;
    }
    groupStates.delete(groupId);
    positionsByGroup.delete(groupId);
    if (clearKeys) {
      deps.clearEpochKeys(groupId);
    }
  };

  const scheduleWake = () => {
    clearSchedule();
    if (!active) {
      return;
    }

    const now = deps.now();
    let soonest = Number.POSITIVE_INFINITY;
    for (const state of groupStates.values()) {
      if (!state.inFlight) {
        soonest = Math.min(soonest, state.nextDueAt);
      }
    }

    if (soonest === Number.POSITIVE_INFINITY) {
      soonest = now + STEADY_INTERVAL_MS;
    }

    scheduled = deps.schedule(
      () => {
        void tick({ force: false });
      },
      Math.max(0, soonest - now),
    );
  };

  const markGroupSuccess = (groupId: string, runId: number) => {
    const state = groupStates.get(groupId);
    if (!state || state.runId !== runId || !active) {
      return;
    }
    state.backoffMs = STEADY_INTERVAL_MS;
    state.nextDueAt = deps.now() + STEADY_INTERVAL_MS;
  };

  const markGroupFailure = (groupId: string, runId: number) => {
    const state = groupStates.get(groupId);
    if (!state || state.runId !== runId || !active) {
      return;
    }
    state.nextDueAt = deps.now() + state.backoffMs;
    state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
  };

  const mergeDecrypted = async ({
    groupId,
    points,
    runId,
  }: {
    groupId: string;
    points: readonly MapTrackingEncryptedPoint[];
    runId: number;
  }) => {
    const entries: LiveMapEntry[] = [];

    for (const point of points) {
      if (!isCurrent(groupId, runId)) {
        return;
      }

      const result = await deps.decryptPoint({ groupId, point });
      if (!isCurrent(groupId, runId)) {
        return;
      }

      if (result.status === "ok") {
        entries.push(result.entry);
      }
    }

    if (entries.length === 0 || !isCurrent(groupId, runId)) {
      return;
    }

    const groupEntries = positionsByGroup.get(groupId) ?? new Map<string, LiveMapEntry>();
    positionsByGroup.set(groupId, reduceLivePositions(groupEntries, entries));
    notify();
  };

  const coldTick = async (groupId: string, runId: number) => {
    const { points } = await deps.getLatest(groupId);
    if (!isCurrent(groupId, runId)) {
      return;
    }

    const state = groupStates.get(groupId);
    if (!state || points.length === 0) {
      return;
    }

    await mergeDecrypted({ groupId, points, runId });
    if (!isCurrent(groupId, runId)) {
      return;
    }

    state.cursor = maxCursor(points);
    state.mode = "live";
  };

  const liveTick = async (groupId: string, runId: number) => {
    const state = groupStates.get(groupId);
    if (!state || state.mode !== "live" || !state.cursor) {
      return;
    }

    let cursor = state.cursor;

    for (;;) {
      if (!isCurrent(groupId, runId)) {
        return;
      }

      const { points } = await deps.poll({
        cursor,
        groupId,
        limit: POLL_LIMIT,
      });

      if (!isCurrent(groupId, runId)) {
        return;
      }

      if (points.length === 0) {
        break;
      }

      const nextCursor = maxCursor(points);
      if (!nextCursor || !isCursorAfter(nextCursor, cursor)) {
        break;
      }

      await mergeDecrypted({ groupId, points, runId });
      if (!isCurrent(groupId, runId)) {
        return;
      }

      cursor = nextCursor;
      state.cursor = cursor;
      state.mode = "live";

      if (points.length < POLL_LIMIT) {
        break;
      }
    }
  };

  const reconcileTick = async (groupId: string, runId: number) => {
    const { points } = await deps.getLatest(groupId);
    if (!isCurrent(groupId, runId) || points.length === 0) {
      return;
    }

    await mergeDecrypted({ groupId, points, runId });
  };

  const tickGroup = async (groupId: string) => {
    const state = groupStates.get(groupId);
    if (!state || !active || state.inFlight) {
      return;
    }

    state.inFlight = true;
    const runId = state.runId;

    const result = await tryCatch(
      (async () => {
        if (state.mode === "cold" || !state.cursor) {
          await coldTick(groupId, runId);
          return;
        }

        if (deps.now() - state.lastReconcileAt >= RECONCILE_INTERVAL_MS) {
          await reconcileTick(groupId, runId);
          if (isCurrent(groupId, runId)) {
            state.lastReconcileAt = deps.now();
          }
        }

        await liveTick(groupId, runId);
      })(),
    );

    const current = groupStates.get(groupId);
    if (current && current.runId === runId) {
      current.inFlight = false;
    }

    if (!isCurrent(groupId, runId)) {
      return;
    }

    if (result.error) {
      markGroupFailure(groupId, runId);
      return;
    }

    markGroupSuccess(groupId, runId);
  };

  const syncMembership = async () => {
    const groupsResult = await tryCatch(deps.listGroups());
    if (!active) {
      return null;
    }

    if (groupsResult.error) {
      return null;
    }

    const groups = groupsResult.data;
    const groupIds = new Set(groups.map(({ id }) => id));
    let removedGroups = false;

    for (const groupId of [...groupStates.keys()]) {
      if (!groupIds.has(groupId)) {
        removeGroup(groupId);
        removedGroups = true;
      }
    }

    if (removedGroups) {
      notify();
    }

    for (const { id: groupId } of groups) {
      ensureGroupState(groupId);
    }

    return groups;
  };

  const tickInternal = async ({ force }: { force: boolean }) => {
    tickPhase = "listing";
    const groups = await syncMembership();
    if (!active) {
      tickPhase = "idle";
      return;
    }

    if (!groups) {
      tickPhase = "idle";
      scheduleWake();
      return;
    }

    tickPhase = "groups";
    const now = deps.now();

    await Promise.all(
      groups.map(async ({ id: groupId }) => {
        const state = groupStates.get(groupId);
        if (!state) {
          return;
        }
        if (!force && state.nextDueAt > now) {
          return;
        }
        await tickGroup(groupId);
      }),
    );

    tickPhase = "idle";
    if (active) {
      scheduleWake();
    }
  };

  const tick = async ({ force }: { force: boolean } = { force: true }) => {
    if (!active) {
      return;
    }

    if (tickPromise) {
      if (tickPhase === "groups") {
        await syncMembership();
      }
      await tickPromise;
      return;
    }

    tickPromise = tickInternal({ force }).finally(() => {
      tickPromise = null;
      tickPhase = "idle";
    });

    await tickPromise;
  };

  return {
    destroy: () => {
      active = false;
      clearSchedule();
      listeners.clear();
      for (const groupId of [...groupStates.keys()]) {
        removeGroup(groupId, { clearKeys: false });
      }
      positionsByGroup.clear();
      deps.clearEpochKeys();
    },
    getLivePositions: () => [...getLiveMap().values()].map(toLiveMapPosition),
    setActive: (nextActive: boolean) => {
      if (active === nextActive) {
        if (nextActive) {
          void tick({ force: true });
        }
        return;
      }

      active = nextActive;
      if (!active) {
        clearSchedule();
        for (const state of groupStates.values()) {
          state.runId += 1;
          state.inFlight = false;
        }
        return;
      }

      for (const state of groupStates.values()) {
        state.nextDueAt = deps.now();
      }
      void tick({ force: true });
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    tick: () => tick({ force: true }),
  };
};
