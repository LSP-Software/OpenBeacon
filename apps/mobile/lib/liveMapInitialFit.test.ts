import { describe, expect, test } from "bun:test";
import {
  createLiveMapInitialFitState,
  LIVE_MAP_INITIAL_FIT_COALESCE_MS,
  reduceLiveMapInitialFit,
} from "./liveMapInitialFit.ts";

describe("reduceLiveMapInitialFit", () => {
  test("does not fit while waiting for the first markers", () => {
    const result = reduceLiveMapInitialFit(createLiveMapInitialFitState(), {
      nowMs: 1_000,
      type: "markers",
      userIds: [],
    });

    expect(result.shouldFit).toBe(false);
    expect(result.state.phase).toBe("waiting");
  });

  test("fits the first non-empty cohort and opens a coalesce window", () => {
    const result = reduceLiveMapInitialFit(createLiveMapInitialFitState(), {
      nowMs: 1_000,
      type: "markers",
      userIds: ["self"],
    });

    expect(result.shouldFit).toBe(true);
    expect(result.state).toEqual({
      coalesceStartedAtMs: 1_000,
      fittedUserIds: ["self"],
      phase: "coalescing",
    });
  });

  test("refits when newly arriving members expand the initial cohort", () => {
    const afterSelf = reduceLiveMapInitialFit(createLiveMapInitialFitState(), {
      nowMs: 1_000,
      type: "markers",
      userIds: ["self"],
    });

    const afterGroup = reduceLiveMapInitialFit(afterSelf.state, {
      nowMs: 1_200,
      type: "markers",
      userIds: ["self", "alice"],
    });

    expect(afterGroup.shouldFit).toBe(true);
    expect(afterGroup.state.fittedUserIds).toEqual(["self", "alice"]);
    expect(afterGroup.state.phase).toBe("coalescing");
  });

  test("does not refit when the cohort is unchanged during coalescing", () => {
    const afterSelf = reduceLiveMapInitialFit(createLiveMapInitialFitState(), {
      nowMs: 1_000,
      type: "markers",
      userIds: ["self"],
    });

    const again = reduceLiveMapInitialFit(afterSelf.state, {
      nowMs: 1_100,
      type: "markers",
      userIds: ["self"],
    });

    expect(again.shouldFit).toBe(false);
    expect(again.state.fittedUserIds).toEqual(["self"]);
  });

  test("closes the initial fit after the coalesce window elapses", () => {
    const afterSelf = reduceLiveMapInitialFit(createLiveMapInitialFitState(), {
      nowMs: 1_000,
      type: "markers",
      userIds: ["self"],
    });

    const closed = reduceLiveMapInitialFit(afterSelf.state, {
      nowMs: 1_000 + LIVE_MAP_INITIAL_FIT_COALESCE_MS,
      type: "coalesce_elapsed",
    });

    expect(closed.shouldFit).toBe(false);
    expect(closed.state.phase).toBe("closed");

    const lateMember = reduceLiveMapInitialFit(closed.state, {
      nowMs: 1_000 + LIVE_MAP_INITIAL_FIT_COALESCE_MS + 50,
      type: "markers",
      userIds: ["self", "alice"],
    });

    expect(lateMember.shouldFit).toBe(false);
    expect(lateMember.state.phase).toBe("closed");
  });

  test("user camera control closes initial fit so later arrivals are not auto-framed", () => {
    const afterSelf = reduceLiveMapInitialFit(createLiveMapInitialFitState(), {
      nowMs: 1_000,
      type: "markers",
      userIds: ["self"],
    });

    const afterPan = reduceLiveMapInitialFit(afterSelf.state, {
      type: "user_camera_control",
    });

    expect(afterPan.shouldFit).toBe(false);
    expect(afterPan.state.phase).toBe("closed");

    const afterAlice = reduceLiveMapInitialFit(afterPan.state, {
      nowMs: 1_100,
      type: "markers",
      userIds: ["self", "alice"],
    });

    expect(afterAlice.shouldFit).toBe(false);
  });

  test("show everyone closes initial auto-fit without blocking explicit fitLiveMapMarkers", () => {
    const afterSelf = reduceLiveMapInitialFit(createLiveMapInitialFitState(), {
      nowMs: 1_000,
      type: "markers",
      userIds: ["self"],
    });

    const afterShowEveryone = reduceLiveMapInitialFit(afterSelf.state, {
      type: "show_everyone",
    });

    expect(afterShowEveryone.shouldFit).toBe(false);
    expect(afterShowEveryone.state.phase).toBe("closed");
  });

  test("reset reopens waiting so a remounted map can fit again", () => {
    const closed = reduceLiveMapInitialFit(
      {
        coalesceStartedAtMs: 1_000,
        fittedUserIds: ["self"],
        phase: "closed",
      },
      { type: "reset" },
    );

    expect(closed).toEqual({
      shouldFit: false,
      state: createLiveMapInitialFitState(),
    });
  });
});
