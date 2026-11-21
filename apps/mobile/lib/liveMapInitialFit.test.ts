import { describe, expect, test } from "bun:test";
import {
  createLiveMapInitialFitState,
  LIVE_MAP_INITIAL_FIT_SETTLE_MS,
  LIVE_MAP_REFIT_AFTER_BACKGROUND_MS,
  reduceLiveMapInitialFit,
} from "./liveMapInitialFit.ts";

const markers = (
  state: ReturnType<typeof createLiveMapInitialFitState>,
  markerIds: readonly string[],
  nowMs: number,
  locationsLoading = false,
) => reduceLiveMapInitialFit(state, { locationsLoading, markerIds, nowMs, type: "markers" });

describe("reduceLiveMapInitialFit", () => {
  test("waits without fitting until someone has a location", () => {
    const result = markers(createLiveMapInitialFitState(), [], 1_000, true);

    expect(result.fit).toBeNull();
    expect(result.state.phase).toBe("waiting");
  });

  test("jumps to the first people to arrive", () => {
    const result = markers(createLiveMapInitialFitState(), ["self"], 1_000, true);

    expect(result.fit).toBe("jump");
    expect(result.state).toEqual({
      fittedMarkerIds: ["self"],
      phase: "fitting",
      settledAtMs: null,
    });
  });

  test("keeps framing new people while locations are still loading, however long it takes", () => {
    const afterSelf = markers(createLiveMapInitialFitState(), ["self"], 1_000, true);
    const afterAlice = markers(afterSelf.state, ["self", "alice"], 20_000, true);
    const afterBob = markers(afterAlice.state, ["self", "alice", "bob"], 40_000, false);

    expect(afterAlice.fit).toBe("animate");
    expect(afterBob.fit).toBe("animate");
    expect(afterBob.state).toEqual({
      fittedMarkerIds: ["self", "alice", "bob"],
      phase: "fitting",
      settledAtMs: 40_000,
    });
  });

  test("does not refit when nobody new arrives", () => {
    const afterSelf = markers(createLiveMapInitialFitState(), ["self", "alice"], 1_000, true);
    const again = markers(afterSelf.state, ["alice", "self", "self"], 1_500, true);

    expect(again.fit).toBeNull();
    expect(again.state.fittedMarkerIds).toEqual(["self", "alice"]);
  });

  test("frames someone whose location lands shortly after loading finishes", () => {
    const loaded = markers(createLiveMapInitialFitState(), ["alice"], 1_000, false);
    const selfFix = markers(
      loaded.state,
      ["alice", "self"],
      1_000 + LIVE_MAP_INITIAL_FIT_SETTLE_MS - 1,
    );

    expect(selfFix.fit).toBe("animate");
    expect(selfFix.state.settledAtMs).toBe(1_000);
  });

  test("stops framing once locations have settled", () => {
    const loaded = markers(createLiveMapInitialFitState(), ["self"], 1_000, false);
    const settled = reduceLiveMapInitialFit(loaded.state, {
      nowMs: 1_000 + LIVE_MAP_INITIAL_FIT_SETTLE_MS,
      type: "settle_elapsed",
    });
    const late = markers(settled.state, ["self", "alice"], 60_000);

    expect(settled.state.phase).toBe("closed");
    expect(late.fit).toBeNull();
  });

  test("closes on a late arrival even if the settle timer never ran", () => {
    const loaded = markers(createLiveMapInitialFitState(), ["self"], 1_000, false);
    const late = markers(loaded.state, ["self", "alice"], 1_000 + LIVE_MAP_INITIAL_FIT_SETTLE_MS);

    expect(late.fit).toBeNull();
    expect(late.state.phase).toBe("closed");
  });

  test("an early settle timer does not close while locations are loading", () => {
    const loading = markers(createLiveMapInitialFitState(), ["self"], 1_000, true);
    const tick = reduceLiveMapInitialFit(loading.state, { nowMs: 60_000, type: "settle_elapsed" });

    expect(tick.state.phase).toBe("fitting");
  });

  test.each(["user_camera_control", "show_everyone"] as const)(
    "%s stops later arrivals moving the map",
    (type) => {
      const afterSelf = markers(createLiveMapInitialFitState(), ["self"], 1_000, true);
      const moved = reduceLiveMapInitialFit(afterSelf.state, { type });
      const afterAlice = markers(moved.state, ["self", "alice"], 1_100, true);

      expect(moved.state.phase).toBe("closed");
      expect(afterAlice.fit).toBeNull();
    },
  );

  test("a user who moves the map before anyone arrives is not overridden", () => {
    const moved = reduceLiveMapInitialFit(createLiveMapInitialFitState(), {
      type: "user_camera_control",
    });

    expect(markers(moved.state, ["self"], 1_000).fit).toBeNull();
  });

  test("frames everyone again after the app was away for a while", () => {
    const closed = reduceLiveMapInitialFit(
      markers(createLiveMapInitialFitState(), ["self", "alice"], 1_000).state,
      { type: "user_camera_control" },
    );
    const back = reduceLiveMapInitialFit(closed.state, {
      awayMs: LIVE_MAP_REFIT_AFTER_BACKGROUND_MS,
      following: false,
      type: "foreground",
    });

    expect(back.state).toEqual(createLiveMapInitialFitState());
    expect(markers(back.state, ["self", "alice"], 900_000).fit).toBe("jump");
  });

  test.each([
    { awayMs: LIVE_MAP_REFIT_AFTER_BACKGROUND_MS - 1, following: false },
    { awayMs: LIVE_MAP_REFIT_AFTER_BACKGROUND_MS, following: true },
  ])(
    "leaves the map alone after a short switch away or while following someone (%o)",
    ({ awayMs, following }) => {
      const closed = reduceLiveMapInitialFit(
        markers(createLiveMapInitialFitState(), ["self"], 1_000).state,
        { type: "user_camera_control" },
      );
      const back = reduceLiveMapInitialFit(closed.state, { awayMs, following, type: "foreground" });

      expect(back.state).toBe(closed.state);
    },
  );
});
