import { describe, expect, mock, test } from "bun:test";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";
import { fitLiveMapMarkers } from "./fitLiveMapMarkers.ts";

const marker = (
  overrides: Partial<LiveMapMarker> & Pick<LiveMapMarker, "latitude" | "longitude" | "userId">,
): LiveMapMarker => ({
  battery: null,
  image: null,
  initials: "Al",
  isSelf: false,
  name: "Alice",
  otherSharedGroupNames: [],
  ringColor: "#E85D4C",
  sourceGroupId: "family",
  timestamp: "2026-07-17T12:00:00.000Z",
  ...overrides,
});

describe("fitLiveMapMarkers", () => {
  test("no-ops when camera or markers are missing", () => {
    const setCamera = mock(() => {});
    const fitBounds = mock(() => {});

    fitLiveMapMarkers({
      camera: null,
      markers: [marker({ latitude: 51.5, longitude: -0.12, userId: "alice" })],
      padding: {
        paddingBottom: 48,
        paddingLeft: 32,
        paddingRight: 32,
        paddingTop: 56,
      },
    });

    fitLiveMapMarkers({
      camera: { setCamera, fitBounds } as never,
      markers: [],
      padding: {
        paddingBottom: 48,
        paddingLeft: 32,
        paddingRight: 32,
        paddingTop: 56,
      },
    });

    expect(setCamera).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  test("centers and zooms when there is a single marker", () => {
    const setCamera = mock(() => {});
    const fitBounds = mock(() => {});

    fitLiveMapMarkers({
      camera: { setCamera, fitBounds } as never,
      markers: [marker({ latitude: 51.5, longitude: -0.12, userId: "alice" })],
      padding: {
        paddingBottom: 48,
        paddingLeft: 32,
        paddingRight: 32,
        paddingTop: 56,
      },
    });

    expect(setCamera).toHaveBeenCalledWith({
      animationDuration: 600,
      centerCoordinate: [-0.12, 51.5],
      padding: {
        paddingBottom: 48,
        paddingLeft: 32,
        paddingRight: 32,
        paddingTop: 56,
      },
      zoomLevel: 14,
    });
    expect(fitBounds).not.toHaveBeenCalled();
  });

  test("fits bounds when there are multiple markers", () => {
    const setCamera = mock(() => {});
    const fitBounds = mock(() => {});

    fitLiveMapMarkers({
      camera: { setCamera, fitBounds } as never,
      markers: [
        marker({ latitude: 51.5, longitude: -0.12, userId: "alice" }),
        marker({ latitude: 50.8, longitude: -1.1, userId: "bob" }),
      ],
      padding: {
        paddingBottom: 48,
        paddingLeft: 32,
        paddingRight: 32,
        paddingTop: 56,
      },
    });

    expect(fitBounds).toHaveBeenCalledWith([-0.12, 51.5], [-1.1, 50.8], [56, 32, 48, 32], 600);
    expect(setCamera).not.toHaveBeenCalled();
  });
});
