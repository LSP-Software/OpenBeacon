export const LIVE_MAP_INITIAL_FIT_COALESCE_MS = 800;

type LiveMapInitialFitState = {
  coalesceStartedAtMs: number | null;
  fittedUserIds: string[];
  phase: "waiting" | "coalescing" | "closed";
};

export const createLiveMapInitialFitState = (): LiveMapInitialFitState => ({
  coalesceStartedAtMs: null,
  fittedUserIds: [],
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

  if (event.userIds.length === 0) {
    return { shouldFit: false, state };
  }

  const nextFittedUserIds = uniqueInOrder(event.userIds);

  if (state.phase === "waiting") {
    return {
      shouldFit: true,
      state: {
        coalesceStartedAtMs: event.nowMs,
        fittedUserIds: nextFittedUserIds,
        phase: "coalescing",
      },
    };
  }

  if (!hasNewMembers(state.fittedUserIds, nextFittedUserIds)) {
    return { shouldFit: false, state };
  }

  return {
    shouldFit: true,
    state: {
      ...state,
      fittedUserIds: nextFittedUserIds,
    },
  };
};

const uniqueInOrder = (userIds: readonly string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const userId of userIds) {
    if (seen.has(userId)) {
      continue;
    }
    seen.add(userId);
    result.push(userId);
  }
  return result;
};

const hasNewMembers = (fittedUserIds: readonly string[], nextUserIds: readonly string[]) =>
  nextUserIds.some((userId) => !fittedUserIds.includes(userId));

type LiveMapInitialFitEvent =
  | { type: "markers"; userIds: readonly string[]; nowMs: number }
  | { type: "coalesce_elapsed"; nowMs: number }
  | { type: "user_camera_control" }
  | { type: "show_everyone" }
  | { type: "reset" };
