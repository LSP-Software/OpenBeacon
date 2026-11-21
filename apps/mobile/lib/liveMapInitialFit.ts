import { hasValidCoordinate, isWithinMapFitBounds, mapFitBounds } from "./fitLiveMapMarkers.ts";

export const LIVE_MAP_INITIAL_FIT_SETTLE_MS = 3_000;
export const LIVE_MAP_INITIAL_FIT_SELF_FIX_WAIT_MS = 15_000;
export const LIVE_MAP_REFIT_AFTER_BACKGROUND_MS = 5 * 60_000;

type LiveMapInitialFitState = {
  awaitingLiveSelfFix: boolean;
  fittedMarkerIds: string[];
  framedBounds: ReturnType<typeof mapFitBounds> | null;
  phase: "waiting" | "fitting" | "closed";
  settledAtMs: number | null;
};

export const createLiveMapInitialFitState = (): LiveMapInitialFitState => ({
  awaitingLiveSelfFix: false,
  fittedMarkerIds: [],
  framedBounds: null,
  phase: "waiting",
  settledAtMs: null,
});

export const reduceLiveMapInitialFit = (
  state: LiveMapInitialFitState,
  event: LiveMapInitialFitEvent,
): { fit: boolean; state: LiveMapInitialFitState } => {
  if (event.type === "user_camera_control" || event.type === "show_everyone") {
    return { fit: false, state: { ...state, phase: "closed" } };
  }

  if (event.type === "foreground") {
    if (event.mapInUse || event.awayMs < LIVE_MAP_REFIT_AFTER_BACKGROUND_MS) {
      return { fit: false, state };
    }
    return { fit: false, state: createLiveMapInitialFitState() };
  }

  if (state.phase === "closed") {
    return { fit: false, state };
  }

  if (event.type === "settle_elapsed") {
    return { fit: false, state: hasSettled(state, event.nowMs) ? closed(state) : state };
  }

  const markerIds = [...new Set(event.markers.map((marker) => marker.deviceId))];
  const validMarkers = event.markers.filter(hasValidCoordinate);
  const framedBounds = validMarkers.length > 0 ? mapFitBounds(validMarkers) : null;

  if (state.phase === "waiting") {
    if (markerIds.length === 0) {
      return { fit: false, state };
    }
    return {
      fit: true,
      state: {
        awaitingLiveSelfFix: event.awaitingLiveSelfFix,
        fittedMarkerIds: markerIds,
        framedBounds,
        phase: "fitting",
        settledAtMs: event.locationsLoading ? null : event.nowMs,
      },
    };
  }

  if (hasSettled(state, event.nowMs)) {
    return { fit: false, state: closed(state) };
  }

  const settledAtMs = event.locationsLoading ? null : (state.settledAtMs ?? event.nowMs);
  const previousBounds = state.framedBounds;
  const hasNewMarker = markerIds.some((markerId) => !state.fittedMarkerIds.includes(markerId));
  const hasMovedOutOfFrame =
    previousBounds !== null &&
    validMarkers.some(
      (marker) =>
        state.fittedMarkerIds.includes(marker.deviceId) &&
        !isWithinMapFitBounds({ bounds: previousBounds, marginFraction: 0.1, point: marker }),
    );

  if (!hasNewMarker && !hasMovedOutOfFrame) {
    return {
      fit: false,
      state: { ...state, awaitingLiveSelfFix: event.awaitingLiveSelfFix, settledAtMs },
    };
  }

  return {
    fit: true,
    state: {
      awaitingLiveSelfFix: event.awaitingLiveSelfFix,
      fittedMarkerIds: markerIds,
      framedBounds,
      phase: "fitting",
      settledAtMs,
    },
  };
};

export const liveMapInitialFitClosesAtMs = (state: LiveMapInitialFitState) => {
  if (state.phase !== "fitting" || state.settledAtMs === null) {
    return null;
  }
  return (
    state.settledAtMs +
    LIVE_MAP_INITIAL_FIT_SETTLE_MS +
    (state.awaitingLiveSelfFix ? LIVE_MAP_INITIAL_FIT_SELF_FIX_WAIT_MS : 0)
  );
};

const hasSettled = (state: LiveMapInitialFitState, nowMs: number) => {
  const closesAtMs = liveMapInitialFitClosesAtMs(state);
  return closesAtMs !== null && nowMs >= closesAtMs;
};

const closed = (state: LiveMapInitialFitState): LiveMapInitialFitState => ({
  ...state,
  phase: "closed",
});

type LiveMapInitialFitEvent =
  | {
      type: "markers";
      markers: readonly { deviceId: string; latitude: number; longitude: number }[];
      locationsLoading: boolean;
      awaitingLiveSelfFix: boolean;
      nowMs: number;
    }
  | { type: "settle_elapsed"; nowMs: number }
  | { type: "foreground"; awayMs: number; mapInUse: boolean }
  | { type: "user_camera_control" }
  | { type: "show_everyone" };
