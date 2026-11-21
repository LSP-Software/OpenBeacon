export const LIVE_MAP_INITIAL_FIT_SETTLE_MS = 3_000;
export const LIVE_MAP_REFIT_AFTER_BACKGROUND_MS = 5 * 60_000;

type LiveMapInitialFitState = {
  fittedMarkerIds: string[];
  phase: "waiting" | "fitting" | "closed";
  settledAtMs: number | null;
};

export const createLiveMapInitialFitState = (): LiveMapInitialFitState => ({
  fittedMarkerIds: [],
  phase: "waiting",
  settledAtMs: null,
});

export const reduceLiveMapInitialFit = (
  state: LiveMapInitialFitState,
  event: LiveMapInitialFitEvent,
): { fit: "jump" | "animate" | null; state: LiveMapInitialFitState } => {
  if (event.type === "user_camera_control" || event.type === "show_everyone") {
    return { fit: null, state: { ...state, phase: "closed" } };
  }

  if (event.type === "foreground") {
    if (event.following || event.awayMs < LIVE_MAP_REFIT_AFTER_BACKGROUND_MS) {
      return { fit: null, state };
    }
    return { fit: null, state: createLiveMapInitialFitState() };
  }

  if (state.phase === "closed") {
    return { fit: null, state };
  }

  if (event.type === "settle_elapsed") {
    return { fit: null, state: hasSettled(state, event.nowMs) ? closed(state) : state };
  }

  const markerIds = [...new Set(event.markerIds)];

  if (state.phase === "waiting") {
    if (markerIds.length === 0) {
      return { fit: null, state };
    }
    return {
      fit: "jump",
      state: {
        fittedMarkerIds: markerIds,
        phase: "fitting",
        settledAtMs: event.locationsLoading ? null : event.nowMs,
      },
    };
  }

  if (hasSettled(state, event.nowMs)) {
    return { fit: null, state: closed(state) };
  }

  const settledAtMs = event.locationsLoading ? null : (state.settledAtMs ?? event.nowMs);

  if (!markerIds.some((markerId) => !state.fittedMarkerIds.includes(markerId))) {
    return { fit: null, state: { ...state, settledAtMs } };
  }

  return {
    fit: "animate",
    state: { fittedMarkerIds: markerIds, phase: "fitting", settledAtMs },
  };
};

const hasSettled = (state: LiveMapInitialFitState, nowMs: number) =>
  state.phase === "fitting" &&
  state.settledAtMs !== null &&
  nowMs >= state.settledAtMs + LIVE_MAP_INITIAL_FIT_SETTLE_MS;

const closed = (state: LiveMapInitialFitState): LiveMapInitialFitState => ({
  ...state,
  phase: "closed",
});

type LiveMapInitialFitEvent =
  | { type: "markers"; markerIds: readonly string[]; locationsLoading: boolean; nowMs: number }
  | { type: "settle_elapsed"; nowMs: number }
  | { type: "foreground"; awayMs: number; following: boolean }
  | { type: "user_camera_control" }
  | { type: "show_everyone" };
