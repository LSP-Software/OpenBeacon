export const LIVE_MAP_INITIAL_FIT_COALESCE_MS = 800;

type LiveMapInitialFitState = {
  coalesceStartedAtMs: number | null;
  fittedMarkerIds: string[];
  phase: "waiting" | "coalescing" | "closed";
};

export const createLiveMapInitialFitState = (): LiveMapInitialFitState => ({
  coalesceStartedAtMs: null,
  fittedMarkerIds: [],
  phase: "waiting",
});

export const reduceLiveMapInitialFit = (
  state: LiveMapInitialFitState,
  event: LiveMapInitialFitEvent,
): { shouldFit: boolean; state: LiveMapInitialFitState } => {
  if (event.type === "reset") {
    return {
      shouldFit: false,
      state: createLiveMapInitialFitState(),
    };
  }

  if (event.type === "user_camera_control" || event.type === "show_everyone") {
    return {
      shouldFit: false,
      state: {
        ...state,
        phase: "closed",
      },
    };
  }

  if (state.phase === "closed") {
    return { shouldFit: false, state };
  }

  if (event.type === "coalesce_elapsed") {
    if (state.phase !== "coalescing" || state.coalesceStartedAtMs === null) {
      return { shouldFit: false, state };
    }

    if (event.nowMs < state.coalesceStartedAtMs + LIVE_MAP_INITIAL_FIT_COALESCE_MS) {
      return { shouldFit: false, state };
    }

    return {
      shouldFit: false,
      state: {
        ...state,
        phase: "closed",
      },
    };
  }

  if (event.markerIds.length === 0) {
    return { shouldFit: false, state };
  }

  const nextFittedMarkerIds = uniqueInOrder(event.markerIds);

  if (state.phase === "waiting") {
    return {
      shouldFit: true,
      state: {
        coalesceStartedAtMs: event.nowMs,
        fittedMarkerIds: nextFittedMarkerIds,
        phase: "coalescing",
      },
    };
  }

  if (!hasNewMembers(state.fittedMarkerIds, nextFittedMarkerIds)) {
    return { shouldFit: false, state };
  }

  return {
    shouldFit: true,
    state: {
      ...state,
      fittedMarkerIds: nextFittedMarkerIds,
    },
  };
};

const uniqueInOrder = (markerIds: readonly string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const markerId of markerIds) {
    if (seen.has(markerId)) {
      continue;
    }
    seen.add(markerId);
    result.push(markerId);
  }
  return result;
};

const hasNewMembers = (fittedMarkerIds: readonly string[], nextMarkerIds: readonly string[]) =>
  nextMarkerIds.some((markerId) => !fittedMarkerIds.includes(markerId));

type LiveMapInitialFitEvent =
  | { type: "markers"; markerIds: readonly string[]; nowMs: number }
  | { type: "coalesce_elapsed"; nowMs: number }
  | { type: "user_camera_control" }
  | { type: "show_everyone" }
  | { type: "reset" };
