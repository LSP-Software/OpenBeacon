import { describe, expect, test } from "bun:test";
import {
  buildLiveMapTrackingCameraStop,
  shouldSuspendLiveMapFollowOnRegionChange,
} from "./liveMapTrackingCamera.ts";

const padding = {
  paddingBottom: 220,
  paddingLeft: 32,
  paddingRight: 32,
  paddingTop: 56,
};

describe("buildLiveMapTrackingCameraStop", () => {
  test("flies to a newly selected person with an explicit focus zoom", () => {
    expect(
      buildLiveMapTrackingCameraStop({
        followSuspended: false,
        latitude: 51.5,
        longitude: -0.12,
        padding,
        previousLatitude: null,
        previousLongitude: null,
        previouslyTrackedUserId: null,
        selectedUserId: "alice",
      }),
    ).toEqual({
      animationDuration: 500,
      animationMode: "flyTo",
      centerCoordinate: [-0.12, 51.5],
      padding,
      zoomLevel: 15,
    });
  });

  test("does not chase coordinate updates for the same selected person", () => {
    expect(
      buildLiveMapTrackingCameraStop({
        followSuspended: false,
        latitude: 50.8,
        longitude: -1.1,
        padding,
        previousLatitude: 51.5,
        previousLongitude: -0.12,
        previouslyTrackedUserId: "alice",
        selectedUserId: "alice",
      }),
    ).toBeNull();
  });

  test("flies again when selection switches to another person", () => {
    expect(
      buildLiveMapTrackingCameraStop({
        followSuspended: false,
        latitude: 51.5,
        longitude: -0.12,
        padding,
        previousLatitude: 50.8,
        previousLongitude: -1.1,
        previouslyTrackedUserId: "alice",
        selectedUserId: "bob",
      }),
    ).toEqual({
      animationDuration: 500,
      animationMode: "flyTo",
      centerCoordinate: [-0.12, 51.5],
      padding,
      zoomLevel: 15,
    });
  });

  test("returns null for heading-only updates that keep the same coordinates", () => {
    expect(
      buildLiveMapTrackingCameraStop({
        followSuspended: false,
        latitude: 51.5,
        longitude: -0.12,
        padding,
        previousLatitude: 51.5,
        previousLongitude: -0.12,
        previouslyTrackedUserId: "alice",
        selectedUserId: "alice",
      }),
    ).toBeNull();
  });

  test("policy: same-person GPS updates never move the camera after the initial focus", () => {
    expect(
      buildLiveMapTrackingCameraStop({
        followSuspended: true,
        latitude: 50.8,
        longitude: -1.1,
        padding,
        previousLatitude: 51.5,
        previousLongitude: -0.12,
        previouslyTrackedUserId: "alice",
        selectedUserId: "alice",
      }),
    ).toBeNull();

    expect(
      buildLiveMapTrackingCameraStop({
        followSuspended: true,
        latitude: 51.5,
        longitude: -0.12,
        padding,
        previousLatitude: 50.8,
        previousLongitude: -1.1,
        previouslyTrackedUserId: "alice",
        selectedUserId: "bob",
      }),
    ).toEqual({
      animationDuration: 500,
      animationMode: "flyTo",
      centerCoordinate: [-0.12, 51.5],
      padding,
      zoomLevel: 15,
    });
  });
});

describe("shouldSuspendLiveMapFollowOnRegionChange", () => {
  test("ignores non-user region changes", () => {
    expect(
      shouldSuspendLiveMapFollowOnRegionChange({
        animated: false,
        isUserInteraction: false,
        nowMs: 1_000,
        suppressUserCameraControlUntilMs: 0,
      }),
    ).toBe(false);
  });

  test("suspends on a real user pan even inside the programmatic suppress window", () => {
    expect(
      shouldSuspendLiveMapFollowOnRegionChange({
        animated: false,
        isUserInteraction: true,
        nowMs: 1_000,
        suppressUserCameraControlUntilMs: 2_000,
      }),
    ).toBe(true);
  });

  test("ignores Android programmatic setCamera false positives only while suppressed", () => {
    expect(
      shouldSuspendLiveMapFollowOnRegionChange({
        animated: true,
        isUserInteraction: true,
        nowMs: 1_000,
        suppressUserCameraControlUntilMs: 2_000,
      }),
    ).toBe(false);

    expect(
      shouldSuspendLiveMapFollowOnRegionChange({
        animated: true,
        isUserInteraction: true,
        nowMs: 2_500,
        suppressUserCameraControlUntilMs: 2_000,
      }),
    ).toBe(true);
  });
});
