import { describe, expect, test } from "bun:test";
import {
  INITIAL_MAP_CAMERA,
  mapCameraAfterFittingMarkers,
  mapCameraFromRegionChange,
} from "./mapPmtilesCameraState.ts";

describe("mapPmtilesCameraState", () => {
  test("starts from a stable world overview camera", () => {
    expect(INITIAL_MAP_CAMERA).toEqual({
      centerCoordinate: [0, 0],
      zoomLevel: 1.25,
    });
  });

  test("captures center and zoom from a region change", () => {
    expect(
      mapCameraFromRegionChange({
        latitude: 51.5,
        longitude: -0.12,
        zoomLevel: 14,
      }),
    ).toEqual({
      centerCoordinate: [-0.12, 51.5],
      zoomLevel: 14,
    });
  });

  test("preserves a single-marker fit camera for remount restore", () => {
    expect(
      mapCameraAfterFittingMarkers({
        markers: [{ latitude: 51.5, longitude: -0.12 }],
        previousCamera: INITIAL_MAP_CAMERA,
      }),
    ).toEqual({
      centerCoordinate: [-0.12, 51.5],
      zoomLevel: 14,
    });
  });

  test("preserves multi-marker fit center while keeping the prior zoom", () => {
    const previousCamera = {
      centerCoordinate: [-0.5, 51] as [number, number],
      zoomLevel: 11,
    };

    expect(
      mapCameraAfterFittingMarkers({
        markers: [
          { latitude: 51.5, longitude: -0.12 },
          { latitude: 50.8, longitude: -1.1 },
        ],
        previousCamera,
      }),
    ).toEqual({
      centerCoordinate: [(-0.12 + -1.1) / 2, (51.5 + 50.8) / 2],
      zoomLevel: 11,
    });
  });
});
