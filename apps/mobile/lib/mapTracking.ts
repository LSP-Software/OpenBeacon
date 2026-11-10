import { tryCatch } from "@openbeacon/shared";
import { type LiveMapEntry, reduceLivePositions } from "./liveMapReducer.ts";
import type {
  LiveMapPosition,
  MapTrackingCursor,
  MapTrackingDeps,
  MapTrackingEncryptedPoint,
  MapTrackingStatus,
} from "./mapTrackingTypes.ts";

export type {
  LiveMapPosition,
  MapTrackingCursor,
  MapTrackingDeps,
  MapTrackingEncryptedPoint,
  MapTrackingStatus,
} from "./mapTrackingTypes.ts";

const STEADY_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;
const POLL_LIMIT = 100;
export const REQUEST_TIMEOUT_MS = 15_000;
const DUE_WINDOW_MS = 1_000;

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

export const isCursorAfter = (candidate: MapTrackingCursor, current: MapTrackingCursor) =>
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
  let activation = 0;
  let lastRunId = 0;
  let scheduled: { cancel: () => void } | null = null;
  let tickPromise: Promise<void> | null = null;
  let tickPhase: "idle" | "listing" | "groups" = "idle";
  let membershipBackoffMs = STEADY_INTERVAL_MS;
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
  const groupLoadStatus = new Map<string, "loaded" | "failed">();
  const undecryptableByGroup = new Map<string, Set<string>>();
  let membershipStatus: MapTrackingStatus["membership"] = "loading";
  let membershipFailing = false;
  const failingGroups = new Set<string>();
  let status: MapTrackingStatus = {
    connection: "ok",
    groups: {},
    membership: "loading",
    undecryptable: [],
  };

  const pendingRequests = new Set<AbortController>();

  const withTimeout = async <T>(request: (signal: AbortSignal) => Promise<T>) => {
    const controller = new AbortController();
    const response = request(controller.signal);
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => {
        reject(new Error("Map tracking request aborted"));
      });
    });
    const timer = deps.schedule(() => controller.abort(), REQUEST_TIMEOUT_MS);
    pendingRequests.add(controller);
    return Promise.race([response, aborted]).finally(() => {
      timer.cancel();
      pendingRequests.delete(controller);
    });
  };

  const currentConnection = (): MapTrackingStatus["connection"] =>
    membershipFailing || failingGroups.size > 0 ? "failing" : "ok";

  const refreshStatus = () => {
    status = {
      connection: currentConnection(),
      groups: Object.fromEntries(groupLoadStatus),
      membership: membershipStatus,
      undecryptable: [...undecryptableByGroup].flatMap(([groupId, userIds]) =>
        [...userIds].map((userId) => ({ groupId, userId })),
      ),
    };
  };

  const publishStatus = (loadChanged: boolean) => {
    if (!loadChanged && currentConnection() === status.connection) {
      return;
    }
    refreshStatus();
    notify();
  };

  const recordGroupResult = (groupId: string, outcome: "loaded" | "failed") => {
    const current = groupLoadStatus.get(groupId);
    const loadChanged = current !== outcome && current !== "loaded";
    if (loadChanged) {
      groupLoadStatus.set(groupId, outcome);
    }
    if (outcome === "failed") {
      failingGroups.add(groupId);
    } else {
      failingGroups.delete(groupId);
    }
    publishStatus(loadChanged);
  };

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

  const nextRunId = () => {
    lastRunId += 1;
    return lastRunId;
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
      runId: nextRunId(),
    };
    groupStates.set(groupId, created);
    return created;
  };

  const removeGroup = (groupId: string, { clearKeys = true }: { clearKeys?: boolean } = {}) => {
    const state = groupStates.get(groupId);
    if (state) {
      state.runId = nextRunId();
      state.inFlight = false;
    }
    groupStates.delete(groupId);
    positionsByGroup.delete(groupId);
    groupLoadStatus.delete(groupId);
    failingGroups.delete(groupId);
    undecryptableByGroup.delete(groupId);
    refreshStatus();
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

  const markGroupSuccess = (groupId: string, runId: number, tickStartedAt: number) => {
    const state = groupStates.get(groupId);
    if (!state || state.runId !== runId || !active) {
      return;
    }
    state.backoffMs = STEADY_INTERVAL_MS;
    const now = deps.now();
    state.nextDueAt =
      tickStartedAt + STEADY_INTERVAL_MS > now
        ? tickStartedAt + STEADY_INTERVAL_MS
        : now + STEADY_INTERVAL_MS;
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
    const undecryptable = new Set(undecryptableByGroup.get(groupId));
    let undecryptableChanged = false;

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
        undecryptableChanged = undecryptable.delete(point.senderUserId) || undecryptableChanged;
      } else if (result.status === "undecryptable" && !undecryptable.has(point.senderUserId)) {
        undecryptable.add(point.senderUserId);
        undecryptableChanged = true;
      }
    }

    if (undecryptableChanged) {
      if (undecryptable.size > 0) {
        undecryptableByGroup.set(groupId, undecryptable);
      } else {
        undecryptableByGroup.delete(groupId);
      }
      refreshStatus();
      if (entries.length === 0) {
        notify();
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
    const { points } = await withTimeout((signal) => deps.getLatest(groupId, signal));
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

    const cursor = state.cursor;
    const { points } = await withTimeout((signal) =>
      deps.poll({ cursor, groupId, limit: POLL_LIMIT }, signal),
    );
    if (!isCurrent(groupId, runId)) {
      return;
    }

    const nextCursor = maxCursor(points);
    if (!nextCursor || !isCursorAfter(nextCursor, cursor)) {
      return;
    }

    if (points.length === POLL_LIMIT) {
      await coldTick(groupId, runId);
      if (isCurrent(groupId, runId) && !isCursorAfter(state.cursor, nextCursor)) {
        state.cursor = nextCursor;
      }
      return;
    }

    await mergeDecrypted({ groupId, points, runId });
    if (!isCurrent(groupId, runId)) {
      return;
    }

    state.cursor = nextCursor;
  };

  const reconcileTick = async (groupId: string, runId: number) => {
    const { points } = await withTimeout((signal) => deps.getLatest(groupId, signal));
    if (!isCurrent(groupId, runId) || points.length === 0) {
      return;
    }

    await mergeDecrypted({ groupId, points, runId });
  };

  const tickGroup = async (groupId: string, tickStartedAt: number) => {
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
      recordGroupResult(groupId, "failed");
      return;
    }

    markGroupSuccess(groupId, runId, tickStartedAt);
    recordGroupResult(groupId, "loaded");
  };

  const recordMembershipResult = (outcome: "loaded" | "failed") => {
    const loadChanged = membershipStatus !== outcome && membershipStatus !== "loaded";
    if (loadChanged) {
      membershipStatus = outcome;
    }
    membershipFailing = outcome === "failed";
    publishStatus(loadChanged);
  };

  const syncMembership = async () => {
    const startedIn = activation;
    const groupsResult = await tryCatch(withTimeout(deps.listGroups));
    if (activation !== startedIn) {
      return null;
    }

    if (groupsResult.error) {
      recordMembershipResult("failed");
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
    recordMembershipResult("loaded");

    return groups;
  };

  const tickInternal = async ({ force }: { force: boolean }) => {
    const startedIn = activation;
    tickPhase = "listing";
    const groups = await syncMembership();
    if (activation !== startedIn) {
      return;
    }

    if (!groups) {
      clearSchedule();
      scheduled = deps.schedule(() => {
        void tick({ force: false });
      }, membershipBackoffMs);
      membershipBackoffMs = Math.min(membershipBackoffMs * 2, MAX_BACKOFF_MS);
      return;
    }

    membershipBackoffMs = STEADY_INTERVAL_MS;
    tickPhase = "groups";
    const now = deps.now();

    await Promise.all(
      groups.map(async ({ id: groupId }) => {
        const state = groupStates.get(groupId);
        if (!state) {
          return;
        }
        if (!force && state.nextDueAt > now + DUE_WINDOW_MS) {
          return;
        }
        await tickGroup(groupId, now);
      }),
    );

    if (activation === startedIn) {
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

    const run = tickInternal({ force }).finally(() => {
      if (tickPromise === run) {
        tickPromise = null;
        tickPhase = "idle";
      }
    });
    tickPromise = run;

    await run;
  };

  const deactivate = () => {
    active = false;
    activation += 1;
    tickPromise = null;
    tickPhase = "idle";
    clearSchedule();
    for (const controller of pendingRequests) {
      controller.abort();
    }
  };

  return {
    destroy: () => {
      deactivate();
      listeners.clear();
      for (const groupId of [...groupStates.keys()]) {
        removeGroup(groupId, { clearKeys: false });
      }
      positionsByGroup.clear();
      deps.clearEpochKeys();
    },
    getLivePositions: () => [...getLiveMap().values()].map(toLiveMapPosition),
    getStatus: () => status,
    setActive: (nextActive: boolean) => {
      if (active === nextActive) {
        if (nextActive) {
          void tick({ force: true });
        }
        return;
      }

      if (!nextActive) {
        deactivate();
        for (const state of groupStates.values()) {
          state.runId = nextRunId();
          state.inFlight = false;
        }
        return;
      }

      active = true;
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
