import { type MapRef } from "@maplibre/maplibre-react-native";
import { tryCatch } from "@openbeacon/shared";
import { useEffect, useRef, useState } from "react";
import type { LayoutRectangle } from "react-native";
import { MAP_CONTROL_CLEARANCE, mapEdgePoint } from "../../lib/mapEdgePoint.ts";
import { mapViewportPoint } from "../../lib/mapViewportPoint.ts";
import { mergeMapEdgePoints } from "../../lib/mergeMapEdgePoints.ts";
import { spaceMapEdgePoints } from "../../lib/spaceMapEdgePoints.ts";

type MapEdgeCandidate = { angle: number; userId: string; x: number; y: number };

export const useLiveMapEdgeMarkers = ({
  markers,
  mapRevision,
  sheetKey,
  topInset,
}: {
  markers: readonly {
    latitude: number;
    longitude: number;
    memberDeviceIds: readonly string[];
    userId: string;
  }[];
  mapRevision: number;
  sheetKey: string | null;
  topInset: number;
}) => {
  const topInsetRef = useRef(topInset);
  topInsetRef.current = topInset;
  const mapRef = useRef<MapRef>(null);
  const mapReadyRef = useRef(false);
  const previousMapRevisionRef = useRef(mapRevision);
  if (previousMapRevisionRef.current !== mapRevision) {
    previousMapRevisionRef.current = mapRevision;
    mapReadyRef.current = false;
  }
  const mapSizeRef = useRef({ width: 0, height: 0 });
  const sheetHeightRef = useRef<number | null>(null);
  const edgeHasSheetRef = useRef(false);
  edgeHasSheetRef.current = sheetKey !== null;
  const edgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeRequestRef = useRef(0);
  const edgeSelectionRevisionRef = useRef(0);
  const edgeLayoutRevisionRef = useRef(0);
  const edgeCameraRevisionRef = useRef(0);
  const edgeBoundsRef = useRef<readonly [readonly number[], readonly number[]] | null>(null);
  const edgeInFlightRef = useRef(false);
  const edgeDirtyRef = useRef(false);
  const edgeControlsRef = useRef<LayoutRectangle | null>(null);
  const edgeSuppressedDeviceIdsRef = useRef<ReadonlySet<string>>(new Set());
  const edgeSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [edgeMarkers, setEdgeMarkers] = useState<Array<MapEdgeCandidate & { memberIds: string[] }>>(
    [],
  );
  const edgeMarkersRef = useRef(edgeMarkers);
  edgeMarkersRef.current = edgeMarkers;
  const markersRef = useRef(markers);
  markersRef.current = markers;

  const isSuppressed = (memberDeviceIds: readonly string[]) =>
    memberDeviceIds.some((deviceId) => edgeSuppressedDeviceIdsRef.current.has(deviceId));

  const edgeViewportHeight = () =>
    Math.max(
      0,
      mapSizeRef.current.height -
        topInsetRef.current -
        (edgeHasSheetRef.current ? (sheetHeightRef.current ?? 220) + 12 : 0),
    );

  const applyEdgeMarkers = (
    projected: MapEdgeCandidate[],
    occupied: readonly { x: number; y: number }[],
  ) => {
    const top = topInsetRef.current;
    const controls = edgeControlsRef.current;
    const next = spaceMapEdgePoints({
      points: mergeMapEdgePoints({ points: projected, previous: edgeMarkersRef.current }),
      occupied: occupied.map((point) => ({ ...point, y: point.y - top })),
      previous: edgeMarkersRef.current.map((edge) => ({ ...edge, y: edge.y - top })),
      controls: controls && { ...controls, y: controls.y - top },
      width: mapSizeRef.current.width,
      height: edgeViewportHeight(),
    }).map((edge) => ({ ...edge, y: edge.y + top }));
    setEdgeMarkers((current) =>
      current.length === next.length &&
      current.every((edge, index) => {
        const candidate = next[index];
        return (
          candidate?.userId === edge.userId &&
          candidate.memberIds.join() === edge.memberIds.join() &&
          candidate.x === edge.x &&
          candidate.y === edge.y &&
          candidate.angle === edge.angle
        );
      })
        ? current
        : next,
    );
  };

  const edgePointBelowStatusBar = (point: [number, number], width: number) => {
    const top = topInsetRef.current;
    const controls = edgeControlsRef.current;
    return mapEdgePoint({
      width,
      height: edgeViewportHeight(),
      point: [point[0], point[1] - top],
      controls: controls && { ...controls, y: controls.y - top },
    });
  };

  const updateEdgeMarkers = () => {
    const bounds = edgeBoundsRef.current;
    const controls = edgeControlsRef.current;
    const { width, height } = mapSizeRef.current;
    if (bounds && controls && mapViewportPoint({ bounds, coordinate: [0, 0], width, height })) {
      edgeDirtyRef.current = false;
      const next: MapEdgeCandidate[] = [];
      const occupied: Array<{ x: number; y: number }> = [];
      for (const marker of markersRef.current) {
        const point = mapViewportPoint({
          bounds,
          coordinate: [marker.longitude, marker.latitude],
          width,
          height,
        });
        if (!point) continue;
        const edge = edgePointBelowStatusBar(point, width);
        if (edge && !isSuppressed(marker.memberDeviceIds)) {
          next.push({ userId: marker.userId, ...edge });
        } else {
          occupied.push({ x: point[0], y: point[1] });
        }
      }
      applyEdgeMarkers(next, occupied);
      return;
    }
    if (!mapReadyRef.current) return;
    edgeDirtyRef.current = true;
    if (edgeTimerRef.current !== null || edgeInFlightRef.current) return;
    edgeTimerRef.current = setTimeout(() => {
      edgeTimerRef.current = null;
      const map = mapRef.current;
      const { width, height } = mapSizeRef.current;
      if (!map || !width || !height || !edgeControlsRef.current) return;
      edgeDirtyRef.current = false;
      edgeInFlightRef.current = true;
      const request = edgeRequestRef.current;
      const selectionRevision = edgeSelectionRevisionRef.current;
      const layoutRevision = edgeLayoutRevisionRef.current;
      const cameraRevision = edgeCameraRevisionRef.current;
      void (async () => {
        const result = await tryCatch(
          Promise.all(
            markersRef.current.map(async (marker) => {
              const point = await map.project([marker.longitude, marker.latitude]);
              const edge = edgePointBelowStatusBar(point, width);
              return {
                memberDeviceIds: marker.memberDeviceIds,
                userId: marker.userId,
                point,
                edge,
              };
            }),
          ),
        );
        if (request !== edgeRequestRef.current) return;
        edgeInFlightRef.current = false;
        if (
          selectionRevision !== edgeSelectionRevisionRef.current ||
          layoutRevision !== edgeLayoutRevisionRef.current ||
          cameraRevision !== edgeCameraRevisionRef.current ||
          map !== mapRef.current
        ) {
          edgeDirtyRef.current = true;
        } else if (!result.error) {
          const next: MapEdgeCandidate[] = [];
          const occupied: Array<{ x: number; y: number }> = [];
          for (const marker of result.data) {
            if (marker.edge && !isSuppressed(marker.memberDeviceIds)) {
              next.push({ userId: marker.userId, ...marker.edge });
            } else {
              occupied.push({ x: marker.point[0], y: marker.point[1] });
            }
          }
          applyEdgeMarkers(next, occupied);
        }
        if (edgeDirtyRef.current) updateEdgeMarkers();
      })();
    }, 16);
  };

  const suppress = (deviceIds: readonly string[]) => {
    edgeSuppressedDeviceIdsRef.current = new Set(deviceIds);
    edgeSelectionRevisionRef.current += 1;
    if (edgeSuppressionTimerRef.current !== null) clearTimeout(edgeSuppressionTimerRef.current);
    const suppressedSubjectIds = markersRef.current
      .filter((marker) => isSuppressed(marker.memberDeviceIds))
      .map((marker) => marker.userId);
    setEdgeMarkers((current) =>
      current.filter((edge) => !edge.memberIds.some((id) => suppressedSubjectIds.includes(id))),
    );
  };

  const release = () => {
    if (edgeSuppressedDeviceIdsRef.current.size === 0) return;
    edgeSuppressedDeviceIdsRef.current = new Set();
    edgeSelectionRevisionRef.current += 1;
    if (edgeSuppressionTimerRef.current !== null) clearTimeout(edgeSuppressionTimerRef.current);
    edgeSuppressionTimerRef.current = null;
    updateEdgeMarkers();
  };

  const releaseAfter = (durationMs: number) => {
    edgeSuppressionTimerRef.current = setTimeout(() => {
      edgeSuppressionTimerRef.current = null;
      release();
    }, durationMs + 50);
  };

  useEffect(
    () => () => {
      if (edgeTimerRef.current !== null) clearTimeout(edgeTimerRef.current);
      if (edgeSuppressionTimerRef.current !== null) clearTimeout(edgeSuppressionTimerRef.current);
      edgeRequestRef.current += 1;
      edgeInFlightRef.current = false;
    },
    [],
  );

  useEffect(() => {
    updateEdgeMarkers();
  }, [markers]);
  useEffect(() => {
    sheetHeightRef.current = null;
    edgeLayoutRevisionRef.current += 1;
    updateEdgeMarkers();
  }, [sheetKey]);

  return {
    mapRef,
    edgeMarkers,
    isEdgeMarker: (id: string) =>
      edgeMarkersRef.current.some((edge) => edge.memberIds.includes(id)),
    suppress,
    release,
    releaseAfter,
    update: updateEdgeMarkers,
    onMapReady: () => {
      mapReadyRef.current = true;
      updateEdgeMarkers();
    },
    onMapLayout: (layout: LayoutRectangle) => {
      mapSizeRef.current = layout;
      edgeLayoutRevisionRef.current += 1;
      updateEdgeMarkers();
    },
    onControlsLayout: (controls: LayoutRectangle) => {
      edgeControlsRef.current = controls;
      edgeLayoutRevisionRef.current += 1;
      setEdgeMarkers((current) =>
        current.filter(
          (edge) =>
            edge.x <= controls.x - MAP_CONTROL_CLEARANCE ||
            edge.x >= controls.x + controls.width + MAP_CONTROL_CLEARANCE ||
            edge.y <= controls.y - MAP_CONTROL_CLEARANCE ||
            edge.y >= controls.y + controls.height + MAP_CONTROL_CLEARANCE,
        ),
      );
      updateEdgeMarkers();
    },
    onSheetHeightChange: (height: number) => {
      sheetHeightRef.current = height;
      edgeLayoutRevisionRef.current += 1;
      updateEdgeMarkers();
    },
    onRegionChange: (bounds: readonly [readonly number[], readonly number[]] | null) => {
      edgeCameraRevisionRef.current += 1;
      edgeBoundsRef.current = bounds;
    },
  };
};
