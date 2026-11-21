import { describe, expect, test } from "bun:test";
import { mapFitBounds } from "./fitLiveMapMarkers.ts";
import {
  createLiveMapInitialFitState,
  LIVE_MAP_INITIAL_FIT_SETTLE_MS,
  LIVE_MAP_REFIT_AFTER_BACKGROUND_MS,
  reduceLiveMapInitialFit,
} from "./liveMapInitialFit.ts";

const homes: Readonly<Record<string, { latitude: number; longitude: number }>> = {
  alice: { latitude: 51.52, longitude: -0.1 },
  bob: { latitude: 51.48, longitude: -0.15 },
  self: { latitude: 51.5, longitude: -0.12 },
};

const markers = (
  state: ReturnType<typeof createLiveMapInitialFitState>,
  markerIds: readonly string[],
  nowMs: number,
  locationsLoading = false,
  moved: Readonly<Record<string, { latitude: number; longitude: number }>> = {},
) =>
  reduceLiveMapInitialFit(state, {
    locationsLoading,
    markers: markerIds.map((deviceId) => ({
      deviceId,
      ...(moved[deviceId] ?? homes[deviceId] ?? { latitude: 0, longitude: 0 }),
    })),
    nowMs,
    type: "markers",
  });

describe("reduceLiveMapInitialFit", () => {
  test("waits without fitting until someone has a location", () => {
    const result = markers(createLiveMapInitialFitState(), [], 1_000, true);

    expect(result.fit).toBe(false);
    expect(result.state.phase).toBe("waiting");
  });

  test("fits the first people to arrive", () => {
    const result = markers(createLiveMapInitialFitState(), ["self"], 1_000, true);

    expect(result.fit).toBe(true);
    expect(result.state).toMatchObject({
      fittedMarkerIds: ["self"],
      phase: "fitting",
      settledAtMs: null,
    });
  });

  test("keeps framing new people while locations are still loading, however long it takes", () => {
    const afterSelf = markers(createLiveMapInitialFitState(), ["self"], 1_000, true);
    const afterAlice = markers(afterSelf.state, ["self", "alice"], 20_000, true);
    const afterBob = markers(afterAlice.state, ["self", "alice", "bob"], 40_000, false);

    expect(afterAlice.fit).toBe(true);
    expect(afterBob.fit).toBe(true);
    expect(afterBob.state).toMatchObject({
      fittedMarkerIds: ["self", "alice", "bob"],
      phase: "fitting",
      settledAtMs: 40_000,
    });
  });

  test("does not refit when nobody new arrives and nobody leaves the frame", () => {
    const afterSelf = markers(createLiveMapInitialFitState(), ["self", "alice"], 1_000, true);
    const again = markers(afterSelf.state, ["alice", "self", "self"], 1_500, true, {
      self: { latitude: 51.501, longitude: -0.121 },
    });

    expect(again.fit).toBe(false);
    expect(again.state.fittedMarkerIds).toEqual(["self", "alice"]);
  });

  test("refits when someone already framed moves out of the frame", () => {
    const cached = markers(createLiveMapInitialFitState(), ["self"], 1_000, true);
    const liveFix = markers(cached.state, ["self"], 2_000, true, {
      self: { latitude: 51.45, longitude: -0.2 },
    });
    const nearby = markers(liveFix.state, ["self"], 3_000, true, {
      self: { latitude: 51.4505, longitude: -0.2005 },
    });

    expect(liveFix.fit).toBe(true);
    expect(liveFix.state.framedBounds).toEqual(
      mapFitBounds([{ latitude: 51.45, longitude: -0.2 }]),
    );
    expect(nearby.fit).toBe(false);
  });

  test("refits when one of several framed people moves outside the group", () => {
    const loaded = markers(createLiveMapInitialFitState(), ["self", "alice"], 1_000, true);
    const moved = markers(loaded.state, ["self", "alice"], 2_000, true, {
      alice: { latitude: 51.7, longitude: -0.1 },
    });

    expect(moved.fit).toBe(true);
  });

  test("does not refit for someone moving once the window has closed", () => {
    const closed = reduceLiveMapInitialFit(
      markers(createLiveMapInitialFitState(), ["self"], 1_000).state,
      { type: "user_camera_control" },
    );

    expect(
      markers(closed.state, ["self"], 2_000, false, { self: { latitude: 40, longitude: 0 } }).fit,
    ).toBe(false);
  });

  test("frames someone whose location lands shortly after loading finishes", () => {
    const loaded = markers(createLiveMapInitialFitState(), ["alice"], 1_000, false);
    const selfFix = markers(
      loaded.state,
      ["alice", "self"],
      1_000 + LIVE_MAP_INITIAL_FIT_SETTLE_MS - 1,
    );

    expect(selfFix.fit).toBe(true);
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
    expect(late.fit).toBe(false);
  });

  test("closes on a late arrival even if the settle timer never ran", () => {
    const loaded = markers(createLiveMapInitialFitState(), ["self"], 1_000, false);
    const late = markers(loaded.state, ["self", "alice"], 1_000 + LIVE_MAP_INITIAL_FIT_SETTLE_MS);

    expect(late.fit).toBe(false);
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
      expect(afterAlice.fit).toBe(false);
    },
  );

  test("a user who moves the map before anyone arrives is not overridden", () => {
    const moved = reduceLiveMapInitialFit(createLiveMapInitialFitState(), {
      type: "user_camera_control",
    });

    expect(markers(moved.state, ["self"], 1_000).fit).toBe(false);
  });

  test("frames everyone again after the app was away for a while", () => {
    const closed = reduceLiveMapInitialFit(
      markers(createLiveMapInitialFitState(), ["self", "alice"], 1_000).state,
      { type: "user_camera_control" },
    );
    const back = reduceLiveMapInitialFit(closed.state, {
      awayMs: LIVE_MAP_REFIT_AFTER_BACKGROUND_MS,
      mapInUse: false,
      type: "foreground",
    });

    expect(back.state).toEqual(createLiveMapInitialFitState());
    expect(markers(back.state, ["self", "alice"], 900_000).fit).toBe(true);
  });

  test.each([
    { awayMs: LIVE_MAP_REFIT_AFTER_BACKGROUND_MS - 1, mapInUse: false },
    { awayMs: LIVE_MAP_REFIT_AFTER_BACKGROUND_MS, mapInUse: true },
  ])(
    "leaves the map alone after a short switch away or while the map is in use (%o)",
    ({ awayMs, mapInUse }) => {
      const closed = reduceLiveMapInitialFit(
        markers(createLiveMapInitialFitState(), ["self"], 1_000).state,
        { type: "user_camera_control" },
      );
      const back = reduceLiveMapInitialFit(closed.state, { awayMs, mapInUse, type: "foreground" });

      expect(back.state).toBe(closed.state);
    },
  );
});
