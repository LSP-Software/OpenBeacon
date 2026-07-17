import { describe, expect, test } from "bun:test";
import { buildLiveMapTrackingCameraStop } from "./liveMapTrackingCamera.ts";

const padding = {
  paddingBottom: 220,
  paddingLeft: 32,
  paddingRight: 32,
  paddingTop: 56,
};

describe("buildLiveMapTrackingCameraStop", () => {
  test("flies to a newly selected person with zoom", () => {
    expect(
      buildLiveMapTrackingCameraStop({
        latitude: 51.5,
        longitude: -0.12,
        padding,
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

  test("keeps zoom when following the same person to a new coordinate", () => {
    expect(
      buildLiveMapTrackingCameraStop({
        latitude: 50.8,
        longitude: -1.1,
        padding,
        previouslyTrackedUserId: "alice",
        selectedUserId: "alice",
      }),
    ).toEqual({
      animationDuration: 400,
      animationMode: "easeTo",
      centerCoordinate: [-1.1, 50.8],
      padding,
      zoomLevel: 15,
    });
  });

  test("flies again when selection switches to another person", () => {
    expect(
      buildLiveMapTrackingCameraStop({
        latitude: 51.5,
        longitude: -0.12,
        padding,
        previouslyTrackedUserId: "alice",
        selectedUserId: "bob",
      }).animationMode,
    ).toBe("flyTo");
  });
});
