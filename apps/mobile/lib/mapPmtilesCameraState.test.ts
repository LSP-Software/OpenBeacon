import { describe, expect, test } from "bun:test";
import {
  INITIAL_MAP_CAMERA,
  mapCameraFromRegionChange,
  pmtilesUrlChangeCameraPolicy,
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

  test("keeps initial fit and tracked selection across pmtiles url changes", () => {
    expect(pmtilesUrlChangeCameraPolicy()).toEqual({
      resetInitialFit: false,
      resetTrackedUser: false,
    });
  });
});
