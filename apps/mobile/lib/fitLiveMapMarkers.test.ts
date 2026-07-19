import { describe, expect, mock, test } from "bun:test";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";
import { fitLiveMapMarkers } from "./fitLiveMapMarkers.ts";

const padding = {
  paddingBottom: 48,
  paddingLeft: 32,
  paddingRight: 32,
  paddingTop: 56,
} as const;

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

const fit = (markers: readonly LiveMapMarker[]) => {
  const setCamera = mock(() => {});
  const fitBounds = mock(() => {});
  const animationDuration = fitLiveMapMarkers({
    camera: { setCamera, fitBounds } as never,
    markers,
    padding,
  });
  return { animationDuration, fitBounds, setCamera };
};

describe("fitLiveMapMarkers", () => {
  test("no-ops when camera or markers are missing", () => {
    const setCamera = mock(() => {});
    const fitBounds = mock(() => {});

    fitLiveMapMarkers({
      camera: null,
      markers: [marker({ latitude: 51.5, longitude: -0.12, userId: "alice" })],
      padding,
    });

    fitLiveMapMarkers({
      camera: { setCamera, fitBounds } as never,
      markers: [],
      padding,
    });

    expect(setCamera).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  test("rejects invalid coordinates before camera calls", () => {
    const { fitBounds, setCamera } = fit([
      marker({ latitude: Number.NaN, longitude: -0.12, userId: "alice" }),
      marker({ latitude: 51.5, longitude: Number.POSITIVE_INFINITY, userId: "bob" }),
      marker({ latitude: 91, longitude: -0.12, userId: "cara" }),
      marker({ latitude: 51.5, longitude: 181, userId: "dan" }),
    ]);

    expect(setCamera).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "one marker",
      markers: [marker({ latitude: 51.5, longitude: -0.12, userId: "alice" })],
      expected: {
        kind: "setCamera" as const,
        centerCoordinate: [-0.12, 51.5],
        zoomLevel: 14,
      },
    },
    {
      name: "one valid marker among invalid peers",
      markers: [
        marker({ latitude: Number.NaN, longitude: -0.12, userId: "alice" }),
        marker({ latitude: 51.5, longitude: -0.12, userId: "bob" }),
        marker({ latitude: 50, longitude: Number.NaN, userId: "cara" }),
      ],
      expected: {
        kind: "setCamera" as const,
        centerCoordinate: [-0.12, 51.5],
        zoomLevel: 14,
      },
    },
  ])("centers and zooms for $name", ({ expected, markers }) => {
    const { fitBounds, setCamera } = fit(markers);

    expect(setCamera).toHaveBeenCalledWith({
      animationDuration: 600,
      centerCoordinate: expected.centerCoordinate,
      padding,
      zoomLevel: expected.zoomLevel,
    });
    expect(fitBounds).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "ordinary bounds",
      markers: [
        marker({ latitude: 51.5, longitude: -0.12, userId: "alice" }),
        marker({ latitude: 50.8, longitude: -1.1, userId: "bob" }),
      ],
      expectedNe: [-0.12, 51.5],
      expectedSw: [-1.1, 50.8],
    },
    {
      name: "antimeridian crossing",
      markers: [
        marker({ latitude: 10, longitude: 179, userId: "alice" }),
        marker({ latitude: 12, longitude: -179, userId: "bob" }),
      ],
      expectedNe: [-179, 12],
      expectedSw: [179, 10],
    },
    {
      name: "three points preferring the short ocean gap",
      markers: [
        marker({ latitude: 0, longitude: 170, userId: "alice" }),
        marker({ latitude: 1, longitude: 175, userId: "bob" }),
        marker({ latitude: 2, longitude: -170, userId: "cara" }),
      ],
      expectedNe: [-170, 2],
      expectedSw: [170, 0],
    },
  ])("fits $name with preserved padding", ({ expectedNe, expectedSw, markers }) => {
    const { fitBounds, setCamera } = fit(markers);

    expect(fitBounds).toHaveBeenCalledWith(expectedNe, expectedSw, [56, 32, 48, 32], 600);
    expect(setCamera).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "identical coordinates",
      markers: [
        marker({ latitude: 51.5, longitude: -0.12, userId: "alice" }),
        marker({ latitude: 51.5, longitude: -0.12, userId: "bob" }),
      ],
      center: { latitude: 51.5, longitude: -0.12 },
    },
    {
      name: "near-identical tiny extent",
      markers: [
        marker({ latitude: 51.5, longitude: -0.12, userId: "alice" }),
        marker({ latitude: 51.500001, longitude: -0.120001, userId: "bob" }),
      ],
      center: { latitude: 51.5000005, longitude: -0.1200005 },
    },
    {
      name: "identical coordinates near the antimeridian",
      markers: [
        marker({ latitude: 0, longitude: 180, userId: "alice" }),
        marker({ latitude: 0, longitude: 180, userId: "bob" }),
      ],
      center: { latitude: 0, longitude: 180 },
    },
  ])("expands $name to a useful minimum span", ({ center, markers }) => {
    const { fitBounds, setCamera } = fit(markers);

    expect(setCamera).not.toHaveBeenCalled();
    expect(fitBounds).toHaveBeenCalledTimes(1);

    const [ne, sw, paddingConfig, duration] = fitBounds.mock.calls[0] as unknown as [
      [number, number],
      [number, number],
      number[],
      number,
    ];
    const [east, north] = ne;
    const [west, south] = sw;
    const lonSpan = east >= west ? east - west : east + 360 - west;
    let lonCenter = west + lonSpan / 2;
    if (lonCenter > 180) {
      lonCenter -= 360;
    }
    if (lonCenter === -180) {
      lonCenter = 180;
    }

    expect(paddingConfig).toEqual([56, 32, 48, 32]);
    expect(duration).toBe(600);
    expect(north - south).toBeGreaterThanOrEqual(0.02);
    expect(lonSpan).toBeGreaterThan(0.019);
    expect((north + south) / 2).toBeCloseTo(center.latitude, 5);
    expect(lonCenter).toBeCloseTo(center.longitude, 5);
  });
});
